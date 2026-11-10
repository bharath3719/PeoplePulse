# ADR-007: Leave Is a Ledger, in Hundredths of a Day

- **Status:** Accepted
- **Date:** 2 November 2026
- **Context:** Slice 2 — Leave (LVE-01, -03, -04, -05, -08), built before Attendance

---

## Why Leave before Attendance

Attendance's day derivation (TR-11) folds *approved leave* into each `attendance_day`. Building Attendance
first means either a derivation that ignores leave — wrong LOP from the first run — or building Leave
anyway. And Attendance's headline requirement, geo-fenced selfie punch (ATT-01), waits on object storage
(D-6/D-7), the mobile UI kit (D-13) and a worker that Redis (D-6) has not arrived for. Leave needs none
of those, and "apply-leave → approve" is one of the journeys ENGINEERING-STANDARDS §6 names.

## Decision 1 — a balance is the sum of an append-only ledger

TR-15 asks for this; the decision is to hold it at the database, as `employee_event` and `audit_log` are:

- `leave_txn` rows are OPENING, GRANT, ACCRUAL, ADJUSTMENT, DEBIT, REVERSAL. **There is no balance
  column.** A balance is `sum(days_hundredths)` for one employee, leave type and **calendar** year (D-17).
- The app role holds no UPDATE or DELETE on `leave_txn`, and a trigger refuses both anyway. A
  correction is a new ADJUSTMENT with its reason. Erasure follows `employee_event` exactly: purge mode,
  or the one never-paid employee a hard delete names in `app.erasing_employee` (D-19).
- Two partial unique indexes make the ledger refuse what the service must never do: one accrual per
  (employee, type, period) — so a re-run accrual is a no-op — and one DEBIT and one REVERSAL per request,
  so two approvers clicking at once cannot take the days twice.

**Debited at approval, not at request.** A pending request holds its days against what a new request
can draw on, but only an approval writes to the ledger — and re-checks the balance first, because an
adjustment may have moved it since.

## Decision 2 — quantities are integer hundredths of a day

Not days as a JavaScript number, for the reason money is not rupees as one (ADR-005): a balance is a
sum, and policies accrue in fractions that binary floating point cannot hold. Twelve credits of 10/12
of a day sum to 9.999999999999998. Leave turns into money twice — LOP (PAY-03) and encashment (PAY-08).

- `DayHundredths` is a branded integer in `packages/core/src/leave/units.ts`. Columns end
  `_hundredths`. The HTTP boundary speaks **days**, with the unit in the field name, as it speaks rupees.
- Hundredths, not half-days: a request is always a multiple of 50, but a monthly credit of a 10-day
  policy is 83 or 84.
- **Monthly accruals are rounded cumulatively** — each month's credit is what has been earned so far
  this year, rounded, less what had been earned by last month, rounded — so a year of credits sums to
  exactly the entitlement. Rounding each month on its own would leave everyone 0.04 of a day short. The
  partial-month fractions are summed over the LCM of 28–31 so the arithmetic stays in integers.

## Decision 3 — a request runs from one half-day session to another

`start_date`/`start_session` to `end_date`/`end_session`, sessions FIRST and SECOND. A half day is not a
flag that can disagree with the dates, and Attendance will need to know *which* half was taken.

Overlap is checked by session, so a morning and an afternoon on one date are two valid requests. A
request may not cross 31 December: each leave year has its own balance, and two requests say which days
come from which.

## Consequences

- **Year-end processing was due before 1 January 2027** ([OPEN.md D-25](OPEN.md)). Balances are per
  calendar year, so until carry-forward existed, every balance would have started the new year at zero.
  Built in [ADR-008](ADR-008-closing-a-leave-year.md): carry, encash and lapse as ledger entries, by
  per-type rules.
- Changes to policy apply forward. A holiday added after a request does not re-price it (D-23); a
  corrected join date does not re-post accruals (D-24). Both are visible in the ledger, and both need
  a deliberate re-pricing action rather than a silent recompute.
- The RLS boot check now also asks the schema which tables carry a `tenant_id`, and refuses to start if
  one is missing from `TENANT_OWNED_TABLES`. Adding four tables by hand to two lists was the moment that
  check stopped being optional.
