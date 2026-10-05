# PeoplePulse

Cloud HRMS for Indian SMBs (10–200 employees). Core HR, Attendance, Leave, India-statutory Payroll, ATS, Performance, and L&D in one multi-tenant platform.

**Status: Slice 1 is built and runs end to end.** Company signup → login → employee master (create, list, detail, edit, Excel import) → org structure → company settings, on an RLS-isolated tenant. 130 tests green.

---

## Start here

| Document | What it is |
|---|---|
| [docs/BRD.md](docs/BRD.md) | **Business** requirements v1.0 — scope, 8 modules with MoSCoW priorities, NFRs, India statutory obligations, risks, 3-phase release plan |
| [docs/TRD.md](docs/TRD.md) | **Technical** requirements v1.0 — tenancy model, data model, payroll engine spec, API design, security, test strategy |
| [docs/decisions/](docs/decisions/) | ADRs + the open-decisions tracker |

## Architecture

Two deployables, sharing domain packages in a monorepo:

```
apps/
  api/       NestJS — modular monolith, one module per bounded context
  worker/    BullMQ — payroll runs, nightly attendance derivation, accruals, PDFs
  web/       React + Vite + shadcn/ui + TanStack Query/Table — HR console + ESS portal
  mobile/    React Native, Android-first — punch, leave, payslips, approvals
packages/
  payroll/   Statutory engine (PF/ESI/PT/LWF/TDS/gratuity) — pure, no I/O
  db/        Schema, migrations, RLS policies
  core/      Tenant context, RBAC, audit trail
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
- [ENGINEERING-STANDARDS.md](docs/ENGINEERING-STANDARDS.md) — RBAC by permission (never by role), structure, styling, testing.
- [OPEN.md](docs/decisions/OPEN.md) — **everything still undecided**, grouped by what it blocks. Five items block Slice 1.

## Running it

```bash
npm install
cp .env.example .env          # fill in your Postgres password
npm run db:migrate            # schema + RLS policies + the peoplepulse_app role
npm test                      # 130 tests, incl. 13 tenant-isolation + 17 employee-edit, on a real DB

npm run dev:api               # :3000/api/v1
npm run dev:web               # :5173, proxies /api to the API
```

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

### Still open in Slice 1

- **MFA has no UI.** The API is complete (`/auth/mfa/verify`, enrolment, the `MFA_REQUIRED` 403) and
  the guard is tested, but nothing in the web app prompts for a code. MFA is gated by *permission*,
  and the first MFA-gated route now exists: `PATCH /employees/:id/bank` (`employee.bank.edit`). That
  is why bank details have an API and tests but no web form — nobody could submit it. Build the
  prompt before payroll ships, not after; the bank form comes with it.
- **The company switcher has no endpoint.** `useSwitchTenant()` and `POST /auth/switch-tenant` both
  exist, but `/auth/me` does not return the user's *other* tenants, so nothing can render the list.
  Blocks D-16 (the CA-partner channel, risk R3).
- **`DELETE /employees/:id` exists, but the two-tier rule is unbuilt** — hard-delete only when there
  is no payroll history, else anonymise (NFR-08 wants 8-year statutory retention). Nothing in the web
  app calls it yet.

## Why the foundation matters more than it looks

Payroll is Phase 2, but it is the highest-risk module in the BRD (R1: statutory computation errors → real penalties for real customers). It does not stand alone — it consumes the tenant isolation, the audit trail, and the employee master that Phase 1 lays down. Those three are cheap to get right on an empty repo and brutal to retrofit. The first slice is a spine, deliberately.
