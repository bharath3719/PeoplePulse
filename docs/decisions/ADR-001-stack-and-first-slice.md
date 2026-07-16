# ADR-001: Technology Stack and First Increment

- **Status:** ⚠️ **Partially superseded.** Decision 1 (Next.js) is **overturned by [ADR-002](ADR-002-backend-architecture.md)**. Decision 2 (vertical slice first) still stands.
- **Date:** 13 July 2026
- **Deciders:** Product Lead (user), Engineering
- **Context:** [BRD v1.0](../BRD.md) — greenfield build, no code written yet.

---

## Decision 1 — Stack: TypeScript monorepo, Next.js + PostgreSQL

> ## ⚠️ SUPERSEDED BY [ADR-002](ADR-002-backend-architecture.md)
>
> **Do not build on this.** Next.js was chosen here before the TRD existed. The TRD (§2.1–2.2) revealed a heavy background-worker workload — nightly attendance derivation, payroll runs, PDF generation — that Next.js has no execution model for. The backend is **NestJS**, with a separate React + Vite SPA.
>
> **What survives from this section:** PostgreSQL + RLS for tenant isolation, React Native for mobile, TypeScript throughout, integer-paise money, and data-driven statutory rate tables. Only the *framework* changed. The section is kept below for the record.

**Chosen (superseded).**

```
apps/
  web/       Next.js (App Router) — HR admin console + ESS portal
  mobile/    Expo / React Native — punch, leave, payslips  (Phase 1.5)
packages/
  db/        Drizzle ORM schema + migrations + Postgres RLS policies
  payroll/   Pure TS statutory engine (PF / ESI / PT / TDS / gratuity)
  core/      Domain logic, RBAC, audit trail
```

### Rationale

- **One language across web, mobile, and API** keeps a lean team (Constraint C1) fast, and lets the payroll engine be shared verbatim between server and any client-side preview.
- **PostgreSQL row-level security** enforces tenant isolation (NFR-07) at the database layer rather than trusting every application query to remember its `WHERE tenant_id = ?`. For a system holding salary, PAN, Aadhaar, and bank data (R4), a missed filter must be impossible, not merely unlikely.
- **Drizzle** over Prisma for explicit SQL control — the payroll and statutory reporting queries are complex, and we want to see the SQL we ship.
- Next.js App Router gives us server-rendered HR screens and the API layer in one deployable, cutting infra surface for a small team.

### Rejected alternatives

- **Django + DRF** — Python's `Decimal` and the Django admin genuinely suit payroll, but a second language for the mobile app and slower front-end iteration cost us more than the admin scaffolding saves.
- **Spring Boot** — the conventional enterprise HRMS choice and the strongest story for regulated financial computation, but too heavy to iterate on a phased 12-month timeline with a lean team.

### Consequences / non-negotiable constraints this creates

- **Money is stored and computed as integer paise. No floating point anywhere in payroll.** JavaScript's `number` is IEEE-754 double; `0.1 + 0.2 !== 0.3`. A rounding drift of one paisa across a PF ECR filing is a compliance defect (Sev-1 per BRD §10). This must be enforced by the type system in `packages/payroll` and by a lint rule, not by convention.
- Statutory rate tables (PF/ESI/PT/TDS slabs) live in **data, not code** (NFR-12) — they must be updatable each budget cycle without a deploy.
- Cloud provider must have an Indian region (NFR-06, D2) — this rules out some default hosting choices (e.g. Vercel's default regions need checking before we commit).

---

## Decision 2 — First increment: vertical slice (tenant + auth + employee master)

**Chosen.** Build one thin end-to-end path before broadening.

### Scope of slice 1

| Requirement | What it means here |
|---|---|
| — | Company signs up → gets an isolated tenant |
| ADM-01 | RBAC: Super Admin, HR Admin, Payroll Admin, Manager, Employee; MFA for admin roles (NFR-04) |
| CHR-01 | Employee master incl. India identifiers: PAN, Aadhaar, UAN, ESIC |
| CHR-02 | Org structure: legal entity → location → department → designation → grade; reporting hierarchy |
| CHR-09 | Bulk Excel import with a validation report |
| ADM-03 | Immutable audit log (who / what / when / old→new) |

**Definition of done:** deployable, and demoable to a pilot customer.

### Rationale

Payroll (Phase 2) is the highest-risk module in the BRD (R1) and it *inherits* whatever foundation we lay now. Tenant isolation, the audit trail, and the employee master are its substrate — every one of them is expensive to retrofit and cheap to get right on an empty repo. A vertical slice proves all three with real screens rather than on paper.

### Rejected alternatives

- **Headless payroll engine first** — de-risks R1 earliest, which is genuinely tempting. But it produces nothing a pilot customer can log into for months, and BRD assumption A3 depends on pilot customers engaged early for feedback. *We should still start the golden statutory test-case suite (R1 mitigation) in parallel with slice 2 — it does not need to wait for the UI.*
- **Design-only, no code** — the BRD already fixes the module boundaries; further paper design ahead of a working spine would mostly be speculation.

---

## Open questions (not yet decided)

1. **Auth**: build on the framework's own session handling, or adopt a provider? Constraint: MFA required for admin roles (NFR-04), and data residency (NFR-06) may exclude some SaaS auth vendors.
2. **Hosting**: which Indian-region cloud (AWS ap-south-1 / Azure Central India / GCP asia-south1)? Blocks nothing yet, but blocks any deploy.
3. **File/document storage** for the document vault (CHR-03) and payslip PDFs — must be India-region, encrypted at rest.
4. **e-Sign provider** (D4) for offer letters and policy acknowledgment.
