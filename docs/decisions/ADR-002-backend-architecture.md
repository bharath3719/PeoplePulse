# ADR-002: Backend Architecture — NestJS Modular Monolith

- **Status:** Accepted
- **Date:** 13 July 2026
- **Supersedes:** [ADR-001](ADR-001-stack-and-first-slice.md) Decision 1 (Next.js App Router as combined web + API)
- **Context:** [TRD v1.0](../TRD.md) §2.1, §2.2 — published after ADR-001 and in direct conflict with it.

---

## Decision

Two deployable applications, not one.

```
apps/
  api/       NestJS — modular monolith, one module per bounded context
             (core-hr, attendance, leave, payroll, ats, pms, lnd, platform)
  worker/    BullMQ consumers — payroll runs, nightly attendance derivation,
             leave accruals, PDF generation (headless Chromium), imports, notifications
  web/       React + Vite + TanStack Query — HR admin console + ESS portal
  mobile/    React Native, Android-first — punch, leave, payslips, approvals
packages/
  payroll/   Statutory engine (PF / ESI / PT / LWF / TDS / gratuity) — pure, no I/O
  db/        Schema, migrations, RLS policies
  core/      Tenant context, RBAC, audit trail
```

`api` and `worker` share the same domain packages and the same database. The web and mobile clients hold no backend code; they call the API over HTTP.

## Rationale

ADR-001 chose Next.js because a single deployable is cheaper to operate for a lean team (Constraint C1). That reasoning ignored the workload this system actually carries.

The bulk of PeoplePulse's real computation happens with no user waiting on it: nightly attendance derivation across every employee (TR-11), monthly leave accrual posting (TR-15), a payroll run budgeted at under 5 minutes for 200 employees (TR-64), payslip and Form 16 PDFs rendered by driving a headless Chromium (TR-23), and biometric punch ingestion (TR-13). This is a worker fleet, and Next.js has no home for one — its execution model is request-in, response-out. Adopting it would mean bolting a separate worker process onto the side anyway, which buys the operational cost of two deployables while giving up the structural clarity of having designed for two.

NestJS is built for exactly this shape: an HTTP API and a set of queue consumers sharing domain code, with first-class module boundaries. Those boundaries also preserve the TRD's stated path (§2.1) of extracting the payroll worker into its own service once scale demands it — a clean move from a modular monolith, an unpleasant one from a Next.js app.

The monolith-not-microservices call in TRD §2.1 stands and is reinforced: payroll needs transactional consistency with attendance and leave data, which is far simpler in one database.

## What does not change from ADR-001

- PostgreSQL with row-level security as the tenant isolation backstop (NFR-07). **Unchanged and still the most important structural decision in the project.**
- React Native for mobile, Android-first.
- TypeScript throughout.
- Money is integer paise. No floating point in payroll, ever. The TRD omits this; see [OPEN.md](OPEN.md) D-3.
- Statutory rate tables live in data, not code (NFR-12).
- The first increment is still the vertical slice in ADR-001 Decision 2, which is unaffected by this change.

## Consequences

- Two codebases to build, test, and deploy instead of one. Accepted: the worker fleet was never optional.
- A monorepo (pnpm workspaces or similar) is now required so `api` and `worker` can share `packages/payroll`, `packages/db`, and `packages/core` without publishing them.
- The web SPA needs its own auth handling against the API's JWT (TR-50) rather than framework-managed sessions.
- The public careers page (TR-30) is unauthenticated and wants server rendering for SEO. A Vite SPA serves this poorly. **Unresolved** — logged as D-6 in OPEN.md; it does not block Phase 1 (ATS is Phase 3).
