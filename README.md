# PeoplePulse

Cloud HRMS for Indian SMBs (10–200 employees). Core HR, Attendance, Leave, India-statutory Payroll, ATS, Performance, and L&D in one multi-tenant platform.

**Status: Slice 1 is built and runs end to end, and Slice 2 — Leave — is built.** Company signup → login → two-factor authentication → inviting users → managing their access (roles, removal, two-factor reset) → company switcher → employee master (create, list, detail, edit, bank details, Excel import) → org structure → company settings, on an RLS-isolated tenant. Then leave: types, holidays, weekly offs, accruals, apply → approve → cancel, and closing the year (carry forward, encash, lapse), on an append-only ledger; employees sign in as themselves. 311 tests green.

---

## Start here

| Document | What it is |
|---|---|
| [docs/BRD.md](docs/BRD.md) | **Business** requirements v1.0 — scope, 8 modules with MoSCoW priorities, NFRs, India statutory obligations, risks, 3-phase release plan |
| [docs/TRD.md](docs/TRD.md) | **Technical** requirements v1.0 — tenancy model, data model, payroll engine spec, API design, security, test strategy |
| [docs/decisions/](docs/decisions/) | ADRs + the open-decisions tracker |

## Architecture

Two deployables, sharing domain packages in a monorepo. The ones marked *planned* do not exist yet:

```
apps/
  api/       NestJS — modular monolith, one module per bounded context
  worker/    BullMQ — payroll runs, nightly attendance derivation, accruals, PDFs   (planned)
  web/       React + Vite + shadcn/ui + TanStack Query/Table — HR console + ESS portal
  mobile/    React Native, Android-first — punch, leave, payslips, approvals       (planned)
packages/
  payroll/   Statutory engine (PF/ESI/PT/LWF/TDS/gratuity) — pure, no I/O          (planned)
  db/        Schema, migrations, RLS policies
  core/      Tenant context, RBAC, audit trail, leave maths, shared validation
```

PostgreSQL 16 with **row-level security** as the tenant-isolation backstop. Redis for queues and cache. S3-compatible object storage. Everything hosted in an Indian region (NFR-06).

Two rules that are not negotiable, because violating either is a compliance defect rather than a bug:

- **Money is integer paise.** No floating point anywhere in payroll. JavaScript numbers are IEEE-754 doubles and `0.1 + 0.2 !== 0.3`; a sub-rupee drift across a PF filing is a Sev-1 by BRD §10.
- **Statutory rate tables live in data, not code** (NFR-12), so PF/ESI/PT/TDS slabs can change each budget cycle without a deploy.

## Decisions

- [ADR-001](docs/decisions/ADR-001-stack-and-first-slice.md) — first increment is a vertical slice. *(Its stack section is superseded.)*
- [ADR-002](docs/decisions/ADR-002-backend-architecture.md) — NestJS modular monolith, superseding the earlier Next.js choice.
- [ADR-003](docs/decisions/ADR-003-frontend-ui-stack.md) — shadcn/ui + Tailwind + TanStack Table for the web front end.
- [ADR-004](docs/decisions/ADR-004-statutory-applicability.md) — PF/ESI are **gated by two eligibility checks**, not computed for everyone. Corrects the TRD.
- [ADR-005](docs/decisions/ADR-005-data-layer.md) — money, RLS-under-pooler, ORM, auth. **Closes the last blockers on Slice 1.**
- [ADR-006](docs/decisions/ADR-006-rls-requires-an-unprivileged-role.md) — **RLS is worthless if the app connects as a superuser.** Caught a live cross-tenant write.
- [ADR-007](docs/decisions/ADR-007-leave-is-a-ledger.md) — Leave before Attendance; **a balance is the sum of an append-only ledger, in integer hundredths of a day.**
- [ADR-008](docs/decisions/ADR-008-closing-a-leave-year.md) — closing a leave year: **carry → encash → lapse by per-type limits**, as a re-runnable close that reports what it will not guess at.
- [ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md) — RBAC by permission (never by role), structure, styling, testing.
- [OPEN.md](docs/decisions/OPEN.md) — **everything still undecided**, grouped by what it blocks. Nothing blocks the slices built so far; the next gate is the first deploy (D-6).

## Running it

```bash
npm install
cp .env.example .env          # fill in your Postgres password
npm run db:migrate            # schema + RLS policies + the peoplepulse_app role
npm test                      # 311 tests, incl. 15 tenant-isolation + 29 leave + 14 year-end + 22 employee-edit/delete + 5 switcher + 42 invitation/access/employee-link + 21 sign-in/MFA + 3 mail + 5 rate-limit, on a real DB

npm run dev:api               # :3000/api/v1
npm run dev:web               # :5173, proxies /api to the API
```

**Invitation emails go to the API's log in development.** Set `SMTP_URL` (see `.env.example`) to
send them for real; without it, each one — link included — is printed by `MailService`, so you can
follow it. The API refuses to start in production without `SMTP_URL`, rather than log links that
work as credentials.

**The tenant-isolation tests fail — loudly — if they cannot reach a database.** They do not skip.
A skipped isolation suite prints "13 skipped" in grey, exits 0, and tells you the build is green
while the only proof that one company cannot read another's salary data did not run. That is
ADR-006's lesson arriving by a different route, and we shipped it for a while: nothing loaded
`.env`, so `npm test` had been quietly skipping all 13 for as long as they had existed. If you
really mean to run without a database, say `SKIP_DB_TESTS=1` and own it.

**Two database roles, and the distinction is load-bearing.** Migrations connect as the owner (they need DDL). The app connects as `peoplepulse_app`, which is `NOSUPERUSER, NOBYPASSRLS`. If the app ever connects as a superuser, **row-level security is silently skipped entirely** and there is no tenant isolation at all — regardless of how correct the policies are. We shipped exactly that bug for about an hour; the isolation suite caught it. `assertRlsEnforced()` now refuses to boot the API if it happens again. See [ADR-006](docs/decisions/ADR-006-rls-requires-an-unprivileged-role.md).

## Slice 1 — built

Company signup → isolated tenant → RBAC → employee master (PAN/UAN/ESIC — **no Aadhaar**) → org
structure → bulk Excel import → audit log. Scope is in
[ADR-001 §Decision 2](docs/decisions/ADR-001-stack-and-first-slice.md).

The employee master carries the PF/ESI eligibility fields from
[ADR-004](docs/decisions/ADR-004-statutory-applicability.md): the form collects the PF wage at
joining and prior-membership facts, and the **server** derives `pfStatus` from them plus the
company's EPF registration. The client cannot set it, because a client that could set it could get
it wrong.

Employee validation (PAN, UAN, IFSC, the create/update schemas) lives in
[packages/core/src/validation/](packages/core/src/validation/) — imported by *both* the API endpoint
and the web form, so the browser enforces exactly the rules the server does. It used to live in the
API's DTO, where a comment claimed it was "shared with the web client"; it was not, and could not be.

**Editing an employee is a *correction*, not a lifecycle event** (`PATCH /employees/:id`). It fixes
what was entered wrong and leaves old → new in the audit log; transfers and promotions (CHR-07) will
be their own effective-dated actions. Three rules it enforces:

- **Hire-time facts** — join date, PF wage at joining, prior PF membership (a UAN implies it) — are
  correctable only until the employee's first finalised payroll run. Correcting one re-derives
  `pfStatus` with the same hire-time function and appends to `employee_event`. Editing anything else
  never recomputes PF ([ADR-004](docs/decisions/ADR-004-statutory-applicability.md)'s trap).
- **Every reference is checked in-tenant.** Postgres runs foreign-key checks *without* RLS, so a
  `department_id` from another company passes the FK; `manager_id` has no FK at all. The service
  asks under the tenant context, and refuses reporting loops.
- **You cannot overwrite what you cannot read**, and bank details are a separate, MFA-gated
  endpoint, so changing where salary goes never rides in under `employee.edit`.

**The public doors are rate-limited** (TR-40), with every limit named in one place
(`LIMITS` in `rate-limit.service.ts`): signups per address (each new company can send invitation
emails), sign-in attempts per address, **wrong passwords per login** — ten in 15 minutes, counted
for addresses with no login too so a lock never says who exists, and shared with accepting an
invitation, which also checks a password — and invitations per company per day and per invitee.
Counts live in Postgres for now, one atomic upsert per hit; TR-40 wants Redis, which arrives with
the hosting decision, and the service's two methods are all a Redis version has to provide. Behind
a load balancer set `TRUST_PROXY`, or every customer shares the balancer's address and one budget.

**Deleting an employee is two-tier** ([D-19](docs/decisions/OPEN.md)), behind `employee.delete`
and a confirmation. Someone never paid is deleted outright, history and all — the typo, the
duplicate import. Someone who has been paid is anonymised instead: name, contact, PAN and bank
details go, but the code, dates, UAN, ESIC number and PF/ESI status stay, because statutory
retention (NFR-08) overrides the erasure right. Either way their reports lose their manager and any
linked login is unlinked, and the audit entry keeps only the employee code — a name in a log that
outlives the row by years would undo the erasure. Hard delete used to fail every time: each
employee's `employee_event` history is immutable, and the cascade hit that trigger. The trigger now
lets exactly one employee's events go, named by the transaction erasing them.

**One login can serve several companies** ([D-16](docs/decisions/OPEN.md)): the CA firm's
accountant. `/auth/me` lists every active membership, and the header becomes a company switcher
when there is more than one. Switching re-issues the token; the API re-checks membership each time
and refuses with a 403, not a 401 — the web client reads a 401 on an authenticated request as an
expired session, so a revoked company would otherwise sign you out of the one you are in.

**Getting someone in is an invitation** (Users, `user.invite`). The inviter picks roles; the
invitee gets an email with a one-time link, valid for 7 days, for their address only. Accepting
creates a login, or — for an address that already has one — attaches it to the company after
checking *that login's* password. Four rules:

- **You can grant only what you hold.** A role is offered, and accepted by the API, only if the
  inviter holds every permission in it (`canGrant`). Otherwise `user.invite` would be a quiet route
  to everything: an HR Admin who cannot see pay invites a second address of their own as Payroll
  Admin.
- **The token carries its tenant** (`<tenant id>.<secret>`), so `user_invitation` stays under RLS
  even though accepting happens before the invitee has a tenant context. Only a SHA-256 of the
  secret is stored, and the link puts it in the URL fragment, which never reaches a server log.
- **One accept per link.** The invitation row is locked for the length of the accept, so a second
  accept waits, then sees the link used.
- **Only the invitee ever holds the link.** It is emailed and never returned to the inviter or
  logged (outside development), so accepting proves the invitee reads that address's mail — which
  is what entitles a new address to choose its own password. The email is sent after the
  invitation commits; if sending fails, the invitation is revoked and the inviter told, rather than
  left in the list looking sent.

**Two-factor authentication is gated by what you can do** (NFR-04), not by role name: holding any
of `MFA_REQUIRED_PERMISSIONS` (bank edit, salary edit, payroll approve/finalize, role and user
management) means those routes refuse a token without a verified code. Setup is an authenticator
app (TOTP): scan a QR code, confirm with the first code. It is asked for at sign-in once set up, and
offered in place — on the bank-details page, say — when it is not. Confirming setup issues ten
one-time **recovery codes**, shown once and stored only as hashes; one stands in for a code when the
phone is gone, and the session it opens can set up a replacement authenticator (Security). Five rules:

- **The token's `mfa` claim means a code was verified on it, never "none was needed".** It used to
  be `!requiresMfa(permissions)`, so someone granted `employee.bank.edit` mid-session carried a
  token that already vouched for a code they had never entered. A verified code does carry across a
  company switch: it proved the person holds their phone, whichever company they are looking at.
- **A password alone cannot replace the authenticator.** First enrolment runs on a
  half-authenticated token (that is all an unenrolled user can hold); once MFA is on, only a token
  that has passed a code or a recovery code may start a replacement — otherwise a stolen password
  could swap in the thief's phone. The new secret waits in its own column, verifying nothing, until
  a code from it is confirmed, so an abandoned replacement leaves the old phone working.
- **A recovery code is one more way to guess at the same door.** Wrong ones count toward the same
  lockout as wrong codes; each right one works once and is audited. Replacing the authenticator
  issues a fresh set, because the rest of the old set may be on the same lost piece of paper.
- **A code works once.** The last accepted time step is stored, and a code at or before it is
  refused (RFC 6238 §5.2) — a code read over a shoulder cannot be replayed within its minute.
- **Five wrong codes lock verification for 15 minutes**, and the lock is audited. Attempts are
  counted under a row lock: without it, a burst of parallel guesses all read "0 attempts" and all
  get a try — the test proves this by failing when the lock is removed.

**Changing or ending someone's access is `user.manage`** (Users → Manage), so it needs a verified
code. An admin can replace a member's roles, reset a lost authenticator, or remove them from the
company. Removal ends the membership, not the login (it may serve other companies) and not any
employee record. Four rules:

- **You can change only someone who can do nothing you cannot — and never yourself.** An HR Admin
  who cannot see pay cannot remove the Payroll Admin or reset their second factor. Together the two
  halves mean a company can never lose its last holder of any permission this way: removing them
  takes someone who holds everything they do, and that person is not removing themselves.
- **A removed user's token dies on its next request.** `resolveActor` now checks the membership
  (and that the login is enabled) alongside the roles, and answers 401. Removal deletes the roles
  too, so coming back by invitation starts from nothing.
- **Leaving does not leave a link behind.** Removal revokes every invitation the person sent that is
  still pending; a demotion revokes the ones that grant more than they now hold. Otherwise a
  departing admin has a week to accept their own invitation, sent to a second address.
- **Two admins removing each other at once leave one.** Both memberships are locked in a fixed
  order and the caller's own access is re-read under the lock — the test fails without it.

A two-factor reset is refused for a login that also belongs to another company: the second factor
belongs to the login, so one company's admin would be switching it off for the other's data too.
That person — like a company's only full admin, whom nobody else can manage — recovers with a
recovery code instead.

### Still open in Slice 1

- **A lost phone with no recovery codes left is still stuck** for the two cases no admin can reset
  (above), and for anyone who set up two-factor before recovery codes existed and has not made a
  set — the Security page asks them to. Those need someone with database access to clear
  `mfa_enabled_at`, until a support console ([D-18](docs/decisions/OPEN.md)) exists.
- **Rate limits count in Postgres, not Redis** (TR-40). Fine at one database; swap the store when
  Redis joins the stack with the hosting decision ([D-6](docs/decisions/OPEN.md)), which also picks
  the SMTP provider. Signup has no CAPTCHA: five per address per hour slows a script, not a botnet.
- **"Has been paid" is a stub until payroll exists.** Deletion is two-tier (above), but the check
  that picks the tier returns *never paid* for everyone, because there are no payroll runs yet. The
  day `payroll_run_item` lands, `hasFinalisedPayroll` must check it — and that table's foreign key to
  `employee` must be `ON DELETE RESTRICT`, so the database refuses to hard-delete anyone paid even if
  the service gets it wrong.

## Slice 2 — Leave — built

Leave types, holidays, weekly offs, accruals, and apply → approve/reject → cancel (LVE-01, -03, -04,
-05, -08), behind the `leave.*` permissions that were already in the registry. Leave came first of the
two Phase 1 modules because Attendance's day derivation reads approved leave, not the other way round
([ADR-007](docs/decisions/ADR-007-leave-is-a-ledger.md)). Web: **Leave** (your balances, apply, your
requests), **Approvals**, **Leave policy**, and a leave card on each employee's profile.

**A balance is never stored.** It is the sum of `leave_txn` — opening balances, grants, monthly
accruals, adjustments, leave taken, leave given back — for one person, type and *calendar* year (D-17).
The ledger is append-only like `employee_event`: no grant, and a trigger. "Why do I have 4.5 days?" is
the History button on the profile, line by line, each manual line with its reason.

**Leave is integer hundredths of a day**, for the reason money is integer paise: balances are sums, and
leave becomes money twice (LOP, encashment). Monthly accruals round *cumulatively*, so a 10-day policy
credits 0.83, 0.84, 0.83 … and the year comes to exactly 10.00. Half days are sessions — a request runs
from one half-day session to another — so a morning and an afternoon on one date are two requests, and
Attendance will know which half was taken.

Six rules:

- **The days are taken at approval, and approval checks again.** A pending request holds its days
  against new requests; only an approval writes the DEBIT, after re-reading the balance. Every change to
  one person's leave locks their employee row first — the test fails with the lock removed, three
  applications spending the same two days — and a unique index means a request is debited at most once
  even if the service gets it wrong.
- **Nobody decides their own leave, or adjusts their own balance,** whatever they hold. Approving your
  own leave is choosing not to be docked pay.
- **A manager decides for their direct reports**; anyone with `leave.view.all` + `leave.approve` for
  anyone. Outside your team, a request is a 404, as an employee is.
- **Working days skip weekly offs and the holidays at the employee's location.** Maternity counts
  calendar days, because the Act's 26 weeks are calendar weeks. A span cannot cross New Year.
- **Posting accruals is idempotent and catches up.** "Through October" posts every missing month and
  nothing twice, so the worker can run it on a schedule later without new code.
- **The boot check now asks the schema which tables have a `tenant_id`.** A new table that holds
  company data but was left off the RLS list stops the API from starting, instead of quietly being
  readable by every company.

**An employee gets a login by invitation from their profile** (Invite to sign in), or an admin links
an existing login under Users → Manage ([D-26](docs/decisions/OPEN.md)). A link makes "my leave" — and
in Phase 2 "my payslip" — mean that person, so it is bounded like granting: `canLink` requires the linker
to see, company-wide, everything the link opens. An HR Admin who cannot see pay therefore cannot link an
Employee; otherwise a second inbox of their own, linked to the founder, would read the founder's payslip.
One login per employee, never yourself, re-checked at accept and on role changes, and read from the
membership on every request so unlinking holds at once.

**Closing a leave year** (Leave policy → Close the leave year; [ADR-008](docs/decisions/ADR-008-closing-a-leave-year.md))
moves what is left of each balance out of the old year by its type's two rules. It carries up to the
carry-forward limit into the next year, sets up to the encashment limit aside for payroll, and lapses the
rest. Each part is a ledger entry (`CARRY_OUT` / `CARRY_IN`, `ENCASHMENT`, `LAPSE`) whose reason names the
rule, so the History button still adds up. By default CL and SL lapse, and EL and maternity carry in full.
Four rules:

- **Preview, then close.** The preview runs the same close and rolls it back, so it cannot disagree with
  it. It works mid-year; the close itself waits until the year has ended in IST.
- **It posts the year's missing credits first,** so December's earned leave does not arrive in a year that
  has already been emptied.
- **It can be run again and converges.** It moves whatever the year still holds, within the room the limits
  have left, so a second close moves nothing and a late correction is swept by the next one. Every employee
  row is locked first, as every leave change does; the race test carries twice without that lock.
- **It does not guess.** A balance with leave awaiting a decision, an overdrawn balance, and the balance of
  someone who left during the year are each left where they are and listed, for HR or full-and-final
  settlement to deal with.

### Still open in Slice 2

See [OPEN.md](docs/decisions/OPEN.md) §"Raised by Slice 2":

- **Who may roll out self-service** (D-26): with the seeded roles, Super Admin or Payroll Admin — not an
  HR Admin who cannot see pay. The Product Lead should confirm that trade-off before pilots.
- **Year-end rules for companies created before 9-Nov-2026** default to carrying everything, CL and SL
  included, until HR sets them (D-25). The EL accumulation limit awaits the SME, and encashment's rate and
  payout wait for Phase 2 payroll.

Also: one approval level, not LVE-03's two (D-20); default entitlements awaiting the SME (D-21); no
optional holidays (D-22); a holiday added after a request does not re-price it (D-23).

## Why the foundation matters more than it looks

Payroll is Phase 2, but it is the highest-risk module in the BRD (R1: statutory computation errors → real penalties for real customers). It does not stand alone — it consumes the tenant isolation, the audit trail, and the employee master that Phase 1 lays down. Those three are cheap to get right on an empty repo and brutal to retrofit. The first slice is a spine, deliberately.
