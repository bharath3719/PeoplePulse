# Open Decisions

Single tracker for everything still undecided across the [BRD](../BRD.md), the [TRD](../TRD.md), and the ADRs. Grouped by **what each one blocks**, so we resolve them just in time rather than all at once.

When one is settled: record it here with the date, and if it is structural, write an ADR.

---

## ✅ Slice 1 is unblocked

**All four remaining blockers were closed by [ADR-005](ADR-005-data-layer.md) on 13-Jul-2026:** money representation (D-1), RLS under a connection pooler (D-2), ORM (D-3), and auth (D-5). The originals are kept below for the record.

Nothing now blocks the start of Slice 1.

---

## ~~🔴 Blocks Slice 1~~ — all resolved, see [ADR-005](ADR-005-data-layer.md)

### D-1 — Money representation *(gap in the TRD)*

The TRD specifies rounding conventions (EPS to the nearest rupee, TR-21) but never states the underlying numeric type. In TypeScript, saying nothing means IEEE-754 doubles — and `0.1 + 0.2 !== 0.3`. Accumulated across a PF ECR filing, a sub-rupee drift is a Sev-1 compliance defect by BRD §10 and a live instance of risk R1.

**Recommendation:** all monetary values are **integer paise**, end to end — database, API, engine. Enforced by a branded TS type (`type Paise = number & { readonly __brand: unique symbol }`) plus a lint rule banning bare arithmetic operators on it inside `packages/payroll`. Rupee conversion happens only at the display and file-export boundary. Rounding rules become explicit, named functions (`roundToNearestRupee`) rather than incidental float behaviour.

**Status:** Open. Needs a one-line ruling, then it goes into the TRD as a new TR.

### D-2 — RLS under a connection pooler *(gap in the TRD)*

TR-01 sets `app.current_tenant` on the DB **session**. Under a transaction-mode pooler (PgBouncer, RDS Proxy), sessions are recycled between requests — so a session-scoped `SET` can survive into another tenant's request. That is precisely the cross-tenant leak RLS exists to prevent (NFR-07), and it fails silently.

**Recommendation:** tenant context is set with `SET LOCAL` **inside an explicit transaction** that wraps every request, never at session scope. The repository layer owns this; no query runs outside a tenant-scoped transaction. TR-62's isolation test suite must include a case that runs under the pooler, not just against a direct connection — a direct-connection test will pass even when production is broken.

**Status:** Open. Needs to be written into the TRD before the DB layer is built.

### D-3 — ORM

The TRD never picks one. NestJS convention is TypeORM or Prisma; ADR-001 had proposed Drizzle.

**Recommendation:** **Drizzle.** Payroll and statutory-register queries are complex and we want to read the SQL we ship. Prisma's generated queries and weaker raw-SQL story fight that. Whatever we pick must be verified to work with RLS session variables (see D-2) — this is a real differentiator between them and should be spiked, not assumed.

**Status:** Open.

### ~~D-4 — Aadhaar: do we store it at all?~~ ✅ **RESOLVED 13-Jul-2026 — do not collect**

**Ruling (Product Lead):** Aadhaar is **not collected or stored in V1.** The field is omitted from the employee master entirely, not merely made optional — storing it optionally would still put us inside Aadhaar Act scope and still require the encryption machinery for no benefit.

Nothing statutory breaks: PF filings require the **UAN**, not Aadhaar. ESI needs the ESIC number. Neither depends on it.

**Consequences:** TRD TR-52's Aadhaar provisions are dormant. Column-level encryption is still required for **PAN and bank account** — that requirement is unchanged. If Aadhaar is ever reintroduced (e.g. for Aadhaar eSign in Phase 3, D-11), it comes back through the Compliance SME first.

### D-5 — Auth: build or buy?

TR-50 specifies building it — Argon2id, JWT with 15-min access + rotating refresh, TOTP MFA, Redis revocation list. That is entirely buildable, but it is security-critical surface a lean team then owns forever.

**Constraint:** data residency (NFR-06) may disqualify SaaS auth vendors that won't hold data in an Indian region — check before assuming buy is even available.

**Status:** Open.

---

## 🟠 Blocks first deploy (not first commit)

### D-6 — Indian-region cloud

AWS `ap-south-1` (Mumbai) / `ap-south-2` (Hyderabad), Azure Central India, or GCP `asia-south1`. Required by NFR-06 and BRD dependency D2. Also determines the KMS used for D-4's per-tenant keys and the S3-compatible store below.

### D-7 — Object storage

S3-compatible, Indian region, private buckets, presigned URLs only (TR-55). Holds the document vault (CHR-03), payslip PDFs, selfies from geo-fenced punches, and L&D videos. Falls out of D-6 in practice.

### D-8 — Careers page rendering *(raised by ADR-002)*

TR-30 puts the careers page at `careers.{product}.in/{tenant-slug}`, unauthenticated and public. A Vite SPA serves that poorly for SEO. Options: a small separate SSR app, server-rendered templates from NestJS, or accept the SPA.

Does not block Phase 1 — ATS is Phase 3.

---

## 🟡 Blocks later phases

### D-13 — Mobile UI kit *(raised by ADR-003)*

[ADR-003](ADR-003-frontend-ui-stack.md) settles the **web** UI stack, but React Native cannot consume web component libraries — so `apps/mobile` needs its own. Options: React Native Paper, Tamagui, NativeWind (Tailwind syntax, which would at least keep the styling idiom consistent with web).

Not needed until the ESS mobile app in Phase 1.5.

### ~~D-9 — PF applicability~~ ✅ **RESOLVED — see [ADR-004](ADR-004-statutory-applicability.md)**

**Ruling (Product Lead, 13-Jul):** fix it. PF must not be deducted from everyone.

Modelled as **two independent gates**, either of which can be closed: is the *establishment* EPF-registered (mandatory at 20+ employees; our segment starts at 10), and is the *employee* a scheme member (the "excluded employee" rule — joined above ₹15,000 PF wage with no prior membership).

The trap ADR-004 exists to prevent: **membership is a fact about history, not current salary.** Once a member, always a member — a raise past ₹15,000 does not eject an existing member, and does not enrol an excluded one. Any engine that recomputes eligibility from this month's wage will silently enrol and un-enrol people as they get raises. ESI is the same shape, fixed at the start of each contribution period.

**Slice 1 impact:** `employee` gains `pf_status`, `esi_status`, `has_prior_pf_membership`, `pf_joining_wage`; `tenant.statutory_profile` gains `epf_registered` / `esi_registered` + codes + start dates. Bulk import (CHR-09) must accept these and must **never infer them from salary**.

### D-10 — PF ceiling default *(TRD OD-5)*

Restrict PF wage to ₹15,000, or compute on actual wage. **TRD recommendation:** tenant-electable, default to restrict. Looks settled; needs SME confirmation alongside D-9.

### D-11 — E-sign vendor *(TRD OD-3, BRD D4)*

**TRD recommendation:** click-wrap for policy acknowledgment (Phase 1); evaluate an Aadhaar-eSign-capable provider for offer letters (Phase 3). Vendor timelines are outside our control — start the conversation early.

### D-12 — WhatsApp BSP *(TRD OD-4, BRD C3)*

**TRD recommendation:** a BSP partner rather than Meta direct, for faster approval. Approval timeline is a known constraint (BRD C3, R7); email and push are the committed channels regardless.

---

---

## 🔵 Gaps found in neither the BRD nor the TRD

These are not "undecided" — they are **unasked**. Raised 13-Jul-2026 on review.

### ~~D-14 — Billing~~ ⏸️ **DEFERRED 13-Jul-2026 (Product Lead)**

Explicitly out of scope for now. **The gap below remains true and unaddressed** — we can build the whole product and have no way to charge for it. Revisit before GA.

One thing worth doing cheaply *now*, while the tenant schema is being designed in Slice 1: retain enough headcount history to reconstruct billable employee-months later. Reconstructing that from an audit log after the fact is painful; recording it as we go is nearly free.

<details>
<summary>Original finding (retained)</summary>

### D-14 — There is no billing module. How do we actually charge customers? 🔴

BRD §2 states the business model plainly: **SaaS subscription, per-employee-per-month, ₹40–₹120 PEPM, tiered plans.** BRD §4 scopes eight modules. **None of them is billing.** There is no subscription entity, no plan/tier enforcement, no payment gateway, no invoice, no dunning, and no way to count billable employees per month. The `tenant` table has a `plan` field (TRD §4.1) and nothing reads it.

We can therefore build the entire product and be unable to take money for it.

**Needs deciding:** payment gateway (Razorpay is the obvious India default; Stripe's India support is more constrained); is there a free trial and how long; what happens on non-payment (grace, then read-only, then suspend); is PEPM billed on headcount at month-start, month-end, or peak; do we bill for employees in `onboarding` or `exited` status; does the plan tier gate modules (which would mean feature flags become billing infrastructure, not just rollout infrastructure).

**Blocks:** monetisation, so effectively GA. Not Slice 1 — but the tenant/plan schema is designed in Slice 1, and headcount-for-billing is much cheaper to get right there than to reconstruct later.

</details>

### ~~D-15 — Which states at launch?~~ ✅ **RESOLVED — Karnataka only**

**Ruling (Product Lead):** V1 ships **Karnataka only.** Other states are added on demand.

This is a large simplification of Phase 2: one PT slab set, one LWF schedule, one set of golden-test fixtures instead of a per-state matrix.

**Two things to carry forward:**
1. **"No PT" is a real, supported case, not a missing row.** Karnataka levies nil below roughly ₹25,000/month and ₹200 above it. The engine must model a zero-tax band explicitly, or every employee under the threshold will look like a configuration bug.
2. **The SME must confirm the current KA slab and the KA LWF schedule** before we freeze any fixture. Do not hardcode from memory — including mine.

Because rate tables are data, not code (NFR-12), adding a state later is a data exercise plus a fixture set — not a re-architecture. The engine must still be *written* state-agnostically even though only one state is populated.

### ~~D-16 — Can one user belong to more than one tenant?~~ ✅ **RESOLVED — yes, via a company switcher**

**Ruling (Product Lead):** a user may belong to **multiple companies**. Build it now.

```
user         (id, email UNIQUE globally, password_hash, mfa_secret, …)
user_tenant  (user_id, tenant_id, roles)          ← the membership
```

The JWT carries the **active** `tenant_id`; switching company re-issues the token.

**Why this does not weaken tenant isolation:** every request still resolves to exactly one tenant, so TR-01 and the RLS policies are **completely unchanged**. Multi-company membership is a *login-time* concern, not a data-layer one. TR-62's cross-tenant isolation tests must additionally assert that a user cannot reach a tenant they hold no `user_tenant` row for.

**Why we paid for it now:** the BRD's "Accountant (CA firm)" persona (§5.2) is an *external login*, not an employee — a CA firm may serve many of our customers. BRD risk **R3** names the **CA-partner channel** as a core mitigation for SMBs' entrenched payroll-outsourcing habit. Making that channel juggle one login per client is friction in exactly the route we are counting on to sell. Retrofitting this later would be a migration through the uniqueness constraint, the JWT shape, the login flow, and every session — the worst place to take one.

**Most employees will still have exactly one `user_tenant` row.** The join table costs them nothing.

**Built (6-Oct-2026):** the company switcher, and invitations — the only way a second company reaches a login. An inviter grants only roles whose permissions they hold. Invitations are emailed to the invitee (since `bf2501b`); the link is never shown to the inviter.

### ~~D-17 — Timezone and financial-year conventions~~ ✅ **RESOLVED**

**Rulings (Product Lead):**

- **Attendance day for night shifts = the day the shift *started*.** An employee on a 22:00–06:00 shift who punches in on 13 July and out at 06:00 on 14 July has **one** attendance day (the 13th), not two half-broken ones. Without this rule both days flag a missing punch and LOP is computed wrong twice. This is what `shift.is_night` (TRD §4.3) is for.
- **Leave year = calendar year** (Jan–Dec).
- **Financial year = April–March.** TDS, Form 16, and investment declarations are FY-scoped.
- These two are **deliberately different**, and both appear in the schema. `leave_balance.year` means the **calendar** year; anything tax-related means the **financial** year. Name the columns so this can never be confused (`calendar_year` vs `financial_year`, not `year`).

Storage remains UTC; display is IST.

### D-18 — Is there an internal support console? 🟠

When a customer's payroll run produces a wrong number at 11pm on the 30th, how does our team look at it? Neither document describes any back-office: no tenant list, no impersonation, no support view, no way to inspect a run without going through the customer's own login.

RLS (TR-01) makes this *deliberately* hard — which is correct, and exactly why it needs designing rather than discovering. Impersonation must be consent-gated and heavily audited (it reads salary data), so it is a security design task, not a CRUD screen.

**Blocks:** supportability at GA. BRD §13 lists "support-readiness (runbooks)" as a phase exit criterion, and this is the missing half of it.

### D-19 — Employee deletion ✅ **RESOLVED** / employee codes 🟡 **still open**

**Ruling (Product Lead) — deletion is two-tier:**

| Case | Behaviour |
|---|---|
| Employee has **no** payroll history | **Hard delete.** Row goes. Fixes typos, duplicate imports, test data. |
| Employee **has** payroll history | **Soft delete / anonymise.** They disappear from every UI, but payslips, PF and TDS records survive. |

This is what NFR-08 requires — statutory records held **≥ 8 years** — while still giving HR a real delete for the case they actually want it in. It also resolves the tension TR-53 flags but does not settle: DPDP's erasure right is **overridden by statutory retention** for payroll records, and the anonymised-but-retained shape is how that override is implemented in practice.

**Implementation note:** "no payroll history" must mean *never appeared in a finalised run*, not *has no current payslip*. Check the run items, not the payslip table.

**Still open — employee code** (`employee.emp_code`): auto-generated with a configurable prefix, or typed by HR? Unique per tenant, presumably — but is it reusable after someone exits? Small, but it is a Slice 1 field.

---

## 🟠 Raised by Slice 2 — Leave (2-Nov-2026)

Leave was built first of the two Phase 1 modules, for the reasons in [ADR-007](ADR-007-leave-is-a-ledger.md).
These came up building it. D-25, the one with a date, is built.

### ~~D-26 — A login cannot be linked to an employee record~~ ✅ **BUILT 3-Nov-2026**

Nothing set `user_tenant.employee_id`, so nobody could apply for leave. Now **both** routes exist: an
invitation may name the employee it is for (Invite to sign in, on their profile — the ESS rollout), and an
admin may link or unlink an existing member (Users → Manage, `user.manage`, so behind a second factor).

**The rule — `canLink`, beside `canGrant` in core:** a link makes the login's `own` and `team` scopes mean
one person, so the linker must hold the company-wide `.all` permission of every family the login holds a
narrower one in. With the seeded roles, **an HR Admin who cannot see pay cannot link an Employee** (who holds
`payslip.view.own`); Super Admin and Payroll Admin can. Otherwise an HR Admin would invite a second inbox of
their own, linked to the founder, and read the founder's payslip as "my own" in Phase 2. A company that
wants HR to roll out self-service grants HR `payslip.view.all` — one click, and a visible choice to let HR
see pay. **Product Lead: confirm this trade-off before pilots** — the alternative is HR rolling out ESS and
a known route to pay.

Also: one login per employee per company (unique index); never linking yourself (as with every
`user.manage` change); removal clears the link; a role change on a linked member is checked for what it
*adds*; a demoted inviter's pending links are revoked; the accept re-checks the employee. The actor's
employee now comes from the membership on every request, not the token, so unlinking takes effect at once.

**Still open:** a founder who is also an employee needs a second admin to link them; and nothing yet
re-checks links when a role's permissions are edited (custom roles, ADM-01, are not editable yet).

### ~~D-25 — Leave year-end: carry-forward, lapse, encashment (LVE-02)~~ ✅ **BUILT 9-Nov-2026 — see [ADR-008](ADR-008-closing-a-leave-year.md)**

Each paid type has a carry-forward limit (none, up to N days, or no limit) and an encashment limit. A
close, in Leave policy, carries what fits, encashes the next part and lapses the rest, as ledger entries
with the rule in each one's reason. It is previewable, re-runnable, and posts the year's missing credits
first. It leaves alone, and lists, any balance with leave awaiting a decision, any that is overdrawn, and
anyone who left during the year. Defaults: CL and SL lapse; EL and ML carry in full.

**Still open:**
- **The SME's EL accumulation limit** (with D-21). EL carries in full until it is set. Carrying more than the
  Act requires is lawful; lapsing what it protects is not.
- **Encashment's rate and payout** are the Payroll Admin's and Phase 2's (PAY-08). Until then an `ENCASHMENT`
  entry is a record of days owed, which the company pays outside PeoplePulse.
- **Companies created before 9-Nov-2026 carry every existing type in full, CL and SL included,** until HR sets
  their rules (no data backfill — ADR-008 says why). The preview shows it before anything moves.
- **Run by hand.** The worker can run the same close on 1 January when it exists; the close is idempotent.

### D-20 — How many approval levels? (LVE-03)

LVE-03 says "multi-level (manager → HR)". Built: **one** level — the employee's manager, or anyone with
company-wide leave access, and never the employee. Multi-level needs ADM-02's workflow configuration
(levels, delegation, 72h escalation per TR-16). Do pilot SMBs want two levels by default, or one?

### D-21 — Default entitlements vs the Karnataka S&E Act

Signup seeds CL 12 (yearly), SL 12 (yearly), EL 15 (monthly), LOP, and Maternity (calendar days,
granted by HR). These are common SMB defaults, **not** statutory minimums. The Compliance SME must
confirm the KA Shops & Commercial Establishments Act minimums before a pilot relies on them — the D-15
rule: not from memory. Maternity eligibility (80 days worked in 12 months; 26 vs 12 weeks by number of
children) is not checked; HR grants it per case.

### D-22 — Optional / restricted holidays (LVE-04)

Every holiday is a day off for everyone at its location. "Pick 2 of these 8" needs an employee choice,
an allowance per year, and a place in the day count. Not built.

### D-23 — Re-pricing leave when holidays or weekly offs change

A request's day count is fixed when it is made. A holiday declared later (Diwali dates move) leaves an
approved request over-charged by a day; removing one under-charges. Options: re-price open and future
approved requests on change, with a ledger ADJUSTMENT per person; or only warn HR. Not decided.

### D-24 — Accruals already posted are not recomputed

A corrected join date or a changed entitlement applies to credits posted from then on. Months already
posted keep their amounts. A recompute would be a ledger ADJUSTMENT per affected person — an explicit
action, like D-23's, not a silent rewrite.

**Also not in Slice 2, and not decisions so much as work:** HR applying on someone's behalf (for staff
not yet on ESS); HR cancelling leave that has already started; the team calendar conflict view (LVE-05);
comp-off (LVE-06, needs attendance); Excel import of opening balances (LVE-08 — one at a time works
today); and the worker posting accruals on a schedule (the endpoint is idempotent and ready for it).

---

## ✅ Resolved

| # | Decision | Outcome | Where |
|---|---|---|---|
| OD-1 | Backend framework | **NestJS** modular monolith + BullMQ workers. Next.js overturned. | [ADR-002](ADR-002-backend-architecture.md) |
| OD-2 | Mobile | **React Native**, Android-first | TRD §2.2, ADR-002 |
| — | Web UI library | **shadcn/ui + Tailwind + TanStack Table**, react-hook-form + zod | [ADR-003](ADR-003-frontend-ui-stack.md) |
| — | Tenancy model | Shared DB + `tenant_id` + **Postgres RLS** | TRD TR-01 |
| — | First increment | **Vertical slice** — tenant, auth/RBAC, employee master, org, import, audit | [ADR-001](ADR-001-stack-and-first-slice.md) Decision 2 |
| — | Architecture style | **Modular monolith**, not microservices | TRD §2.1 |
| D-4 | Aadhaar storage | **Not collected in V1.** Field omitted entirely. UAN covers PF. | Product Lead, 13-Jul |
| — | WCAG 2.1 AA (NFR-09) | **Deferred, not deleted.** Radix retains the option at ~zero cost. | Product Lead, 13-Jul |
| D-14 | Billing | **Deferred.** Real gap; revisit before GA. Keep headcount history meanwhile. | Product Lead, 13-Jul |
| D-15 | States at launch | **Karnataka only.** Engine still written state-agnostically. | Product Lead, 13-Jul |
| D-16 | Multi-company users | **Yes** — `user_tenant` join table + company switcher. RLS unchanged. | Product Lead, 13-Jul |
| D-17 | Timezone / years | Night-shift day = **shift start day**. Leave year = **calendar**. FY = **Apr–Mar**. | Product Lead, 13-Jul |
| D-19 | Employee deletion | **Two-tier:** hard-delete if no payroll history, else anonymise. | Product Lead, 13-Jul |
| D-9 | PF/ESI applicability | **Two gates** — establishment registered + employee is a member. Never inferred from salary. | [ADR-004](ADR-004-statutory-applicability.md) |
| D-1 | Money | Postgres `NUMERIC(14,2)`; **integer paise** in the payroll engine. | [ADR-005](ADR-005-data-layer.md) |
| D-2 | RLS + pooler | **`SET LOCAL`** in a per-request transaction. Never session scope. | [ADR-005](ADR-005-data-layer.md) |
| D-3 | ORM | **Drizzle.** Prove `SET LOCAL` survives the pool in week 1. | [ADR-005](ADR-005-data-layer.md) |
| D-5 | Auth | **Build** per TR-50 — Argon2id, JWT, TOTP MFA. | [ADR-005](ADR-005-data-layer.md) |
| — | Phase 1 order; leave model | **Leave before Attendance.** Append-only ledger in **integer hundredths of a day**; debited at approval; half days as sessions. | [ADR-007](ADR-007-leave-is-a-ledger.md) |
| D-25 | Leave year-end | Per-type **carry → encash → lapse** limits; a re-runnable, previewable close that writes ledger entries and reports what it would not guess at. | [ADR-008](ADR-008-closing-a-leave-year.md) |
