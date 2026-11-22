# ADR-009: Shifts, Rosters and Punches

- **Status:** Accepted
- **Date:** 22 November 2026
- **Context:** Slice 3 — Attendance, first part: ATT-02 (web punch), ATT-04 (shifts and rosters), TR-10

---

## The problem

Attendance is Phase 1's other module, and it is what payroll's loss-of-pay will read once a month is locked
(ATT-09, TR-12). Before any day can be marked present, late or absent, three things have to exist: when someone
is due at work (a shift), which shift and weekly offs apply to them on a given date (a roster), and when they
actually came and went (punches). This ADR covers those three. Day derivation (TR-11), regularization (ATT-05),
the daily dashboard (ATT-08) and the month lock come next and build on them.

The geo-fenced selfie punch (ATT-01) is not here: it needs object storage and the mobile app (D-6, D-7, D-13).
Web punch needs neither.

## Decision 1: a shift is two minutes-past-midnight numbers, and a night shift is one whose end is not after its start

`shift.start_minute` and `end_minute` are IST minutes past midnight, 0–1439, for the reason leave is hundredths
of a day: lateness, half days and overtime are arithmetic on them. "HH:MM" exists only at the edge (the form, the
API body, the screen), through `parseClock` / `formatClock` in `packages/core/src/attendance/shift.ts`.

A shift whose end is at or before its start runs past midnight. There is no `is_night` flag, so there is nothing
that can disagree with the times. This is the same reasoning as leave's half-day sessions, which have no "is half
day" flag either. A shift that ends exactly when it starts is refused by both the schema and a check constraint.
It would be a 24-hour shift or a typo, and either way it leaves no gap between one day's shift and the next, and
Decision 3 needs that gap.

Each company has at most one **default** shift, enforced by a partial unique index. It applies to anyone on a date
that no roster entry covers. Signup seeds one: General, 09:30–18:30, 15 minutes' grace. Companies created before
this ADR start with none, and their first shift becomes the default. Until then, punches count on the calendar date.

## Decision 2: a roster is a timeline of changes with start dates only

`roster_assignment` rows are (employee, shift, `effective_from`, weekly offs). The entry in force on a date is the
latest one starting on or before it (`rosterOn` in core), and it holds until the next one starts. There are no end
dates, so entries cannot overlap and there is never a gap once the first exists. A unique index on
(employee, `effective_from`) means a second entry on the same date replaces the first. A rotation is a series of
entries entered ahead.

**Weekly offs move from the company to the roster.** Each entry states its own weekly offs rather than inheriting
the company's, so that changing the office's setting does not quietly re-roster everyone who already has an
entry. The company's `weekly_off_days` now means "for anyone, on any date, that no roster entry covers".

**Leave counts the roster's weekly offs too.** `WorkingCalendar` gained a `roster`. `isDayOff` asks
`weeklyOffDaysOn`, which returns the entry's weekly offs where one covers the date, and the company's otherwise.
Attendance reads the same entries through `weeklyOffsOn`. Someone rostered Tuesday off takes no leave on a
Tuesday and is not absent on one. If the two disagreed, a single day would be both a leave day and a weekly off,
and LOP would be wrong. As with holidays (D-23), a roster change does not re-price leave already requested.

**Nobody changes their own roster**, whatever they hold. A roster decides which days you are due at work, and so
which days you can be absent from. Moving your own weekly off onto a day you missed is choosing not to be docked
pay, the same as approving your own leave. Changing a roster takes `attendance.manage` (Decision 5) plus sight
of the person's attendance.

A roster is not append-only. It is a plan, and a wrong plan gets corrected. Every change is audited, and once a
month is locked, the lock's snapshot is what payroll reads, not this table.

## Decision 3: a punch belongs to the nearer shift, split at the midpoint of the gap

D-17 ruled that a night shift's attendance day is the day it started. The old helper `attendanceDayOf` took an
`isNight` flag and a fixed cut-over hour. It got the common case right and went wrong around a change of shift:
after a night shift on the 13th and a day shift from the 14th, an 08:45 arrival on the 14th fell before a noon
cut-over and was filed under the 13th.

It is replaced by `attendanceDateOf(instant, shiftOn)` in `packages/core/src/attendance/shift.ts`, which takes the
roster as a function of date. A punch on IST date *d* belongs to *d − 1* if it falls before the midpoint between
the end of *d − 1*'s shift and the start of *d*'s; otherwise it belongs to *d*:

| Roster | Gap | Midpoint | So |
|---|---|---|---|
| Night 22:00–06:00 every day | 06:00 → 22:00 | 14:00 | Out at 06:10 belongs to yesterday; in at 21:50 belongs to today. |
| Day 09:30–18:30 every day | 18:30 → 09:30 | 02:00 | Out at 00:40 after a long evening belongs to yesterday, where the work was. |
| Night on the 13th, day from the 14th | 06:00 → 09:30 | 07:45 | The 08:45 arrival belongs to the 14th. |

With no shift on either day, a punch belongs to its calendar date. A punch is never filed under tomorrow: a shift is
taken to start no earlier than midnight on its own date.

**No attendance date is stored on a punch.** Which day a punch belongs to depends on the roster, and a corrected
roster has to be able to move it, so the date is worked out whenever punches are read. That is one roster query
per person, plus a two-midnight window of punches either side of the range.

**Known behaviour:** a punch at an odd hour goes by the midpoint, whatever its direction. A night-shift worker who
punches in at 13:30 has that punch filed under last night's shift, because it is nearer that shift's end than
tonight's start. Day derivation does not trust direction (some biometric devices guess it), so attribution
can't either. If companies need a configurable window instead, that is D-29.

## Decision 4: a punch is append-only evidence, timed by the server

`punch_event` follows `leave_txn`. The app role has no UPDATE or DELETE grant, and a trigger refuses both anyway.
Erasure works the same way too: purge mode for account closure, and `app.erasing_employee` for a never-paid
employee's hard delete (D-19). A punch is evidence of when someone was at work, and it feeds a statutory register
(the muster roll, RPT-01). A missed or mistaken punch will be corrected by a regularization request (ATT-05)
recorded beside it. The punch itself stays as it was.

**The time is the server's.** `punchSchema` is `{ direction }` and `.strict()`, so a `punchedAt` is refused, not
ignored. A time the browser could send is a time anyone could choose. `punched_at` and `created_at` are separate
columns so that a synced offline mobile punch (TR-10) can carry its device time later. `source` already names
WEB, MOBILE, BIOMETRIC and IMPORT, so a punch's origin is never a guess.

**The direction is checked, under a lock.** The person says IN or OUT, and the server refuses one that doesn't
follow the last punch of the current attendance day (`ALREADY_PUNCHED_IN`, `NOT_PUNCHED_IN`). A double click, or a
second tab that hasn't refreshed, is refused rather than turned into the opposite punch. The employee row is locked
first, as every leave change locks it. The test sends three punches at once and fails with the lock removed. All
three went through.

Punches are not copied into the audit log. Each one already records who, when and how, in a table nothing can
rewrite, and a second copy of every punch would double the busiest table for no extra evidence.

## Decision 5: a new permission, `attendance.manage`, granted to whoever manages leave policy

Shifts and rosters needed a permission, and none of the existing `attendance.*` ones meant "configure". Locking a
month is not the same job. The seeded HR Admin gets it, and Super Admin gets it as it gets everything.

Seeded roles are written into each company as data at signup, so existing companies' roles lacked the new
permission. Migration 0008 grants `attendance.manage` to **every role that already holds `leave.manage`**: the
people who set holidays and weekly offs are the people who set shifts. The grant is chosen by what a role can do,
never by its name (ENGINEERING-STANDARDS §1), so a renamed role is treated the same as a seeded one. The migration
runs company by company under each company's own tenant context, so it works whether or not the migrating role
bypasses RLS.

## Consequences

- Day derivation (TR-11) has what it needs: each day's shift and grace, its weekly off and holiday, and its punches
  in order. It will read them through the same `scheduleFor` / `attendanceDateOf` path the punch card uses, so the
  card and the payroll figure cannot disagree about which day a punch is on.
- Changing a shift's times applies to every day it is rostered on, past days included, until that month is locked.
  This is deliberate: the lock is the boundary that protects what has been paid.
- `attendanceDayOf` is gone from `date/india.ts`. There is one implementation of the night-shift rule, and it lives
  with the shifts it depends on.
- Alternate-Saturday offs ("2nd and 4th Saturday") can't be expressed by a list of weekdays. That is D-27.
