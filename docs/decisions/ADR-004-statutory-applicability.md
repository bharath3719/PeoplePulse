# ADR-004: Statutory Applicability (PF & ESI) — Who Is Actually Covered

- **Status:** Accepted
- **Date:** 13 July 2026
- **Corrects:** [TRD](../TRD.md) TR-21 and §4.1/§4.2 data model
- **Resolves:** [OPEN.md](OPEN.md) D-9
- **⚠️ Every rate, threshold, and rule below requires Compliance SME sign-off before a fixture is frozen (BRD dependency D1). Do not treat this document as authoritative on the statute — treat it as authoritative on the *shape of the model*.**

---

## The defect

TRD TR-21 says: *"EPF: PF wage = Σ components flagged `pf_wage`. Employee 12% of PF wage…"* — and computes it for **every employee of every tenant**.

That is wrong twice over, and both errors deduct money from people who owe none.

**Applicability is two independent gates, and either can be closed:**

1. **Is the company registered?** EPF registration is mandatory only for establishments with **20 or more employees**. Our target segment starts at **10** (BRD §2). A meaningful share of our tenants are simply not PF establishments — they have no EPF code and file no ECR. Nothing should be deducted.

2. **Is this employee a member?** Even inside a registered establishment, the EPF Scheme's **"excluded employee"** rule (Para 2(f)) means an employee who joins with PF wages **above ₹15,000/month** and who was **never previously an EPF member** can be kept out of the scheme.

   The converse also binds, and is the trap: **once a member, always a member.** An existing member who later crosses ₹15,000 does *not* fall out — they stay in (contributions may be restricted to the ceiling, per D-10). So membership is a fact about the employee's *history*, not a function of their current salary.

**Consequence of getting this wrong:** we deduct PF from an employee who owes none, and under-pay them. That is precisely the class of error BRD risk **R1** exists to prevent, and it is a Sev-1 by BRD §10.

**ESI has the same two-gate structure** and is modelled identically — see below.

---

## Schema

### Tenant level — is the establishment registered?

Extends `tenant.statutory_profile` (TRD §4.1):

```
epf_registered            boolean          -- false => no PF for anyone, full stop
epf_establishment_code    text | null
epf_registered_from       date | null      -- coverage starts here; earlier months compute no PF

esi_registered            boolean
esi_establishment_code    text | null
esi_registered_from       date | null
```

An establishment below the threshold **may register voluntarily** (EPF Act §1(4)). So this is an explicit flag HR sets — **never inferred from headcount.** Do not compute `epf_registered = (headcount >= 20)`; a company that crosses 20 employees does not become PF-registered by magic, and one that voluntarily registered at 8 employees is registered regardless.

### Employee level — is this person a member?

Extends `employee_identifiers` / `employee` (TRD §4.2):

```
pf_status                 enum  MEMBER | EXCLUDED | NOT_APPLICABLE
pf_joining_wage           paise | null    -- PF wage at join; justifies an EXCLUDED status
has_prior_pf_membership   boolean         -- had a PF account before joining us
uan                       text | null     -- a UAN's existence is strong evidence of prior membership
pf_restrict_to_ceiling    boolean | null  -- per-employee override of the tenant default (D-10)

esi_status                enum  COVERED | NOT_COVERED | NOT_APPLICABLE
esi_number                text | null
```

`NOT_APPLICABLE` means *the establishment isn't registered* — distinct from `EXCLUDED`, which means *the establishment is registered but this person is out*. They are different facts, they arise for different reasons, and collapsing them into one flag destroys the ability to answer "why did this employee get no PF?" — which is the first question HR will ask.

---

## Engine rules

**PF is computed only if `tenant.epf_registered` AND `employee.pf_status = MEMBER`.** Otherwise the PF lines are absent from the payslip — not zero, *absent*. A ₹0.00 PF row on a payslip at a non-PF company is a support ticket.

### Determining `pf_status` at hire

| Establishment registered? | Prior PF member (or has UAN)? | PF wage at joining | → `pf_status` |
|---|---|---|---|
| No | — | — | `NOT_APPLICABLE` |
| Yes | **Yes** | any | **`MEMBER`** — once a member, always a member |
| Yes | No | ≤ ₹15,000 | `MEMBER` |
| Yes | No | **> ₹15,000** | **`EXCLUDED`** — but may voluntarily opt in |

The excluded employee **may still opt in** by mutual agreement with the employer (Para 26(6), with EPFO approval). So `EXCLUDED` must be a *default that HR can override to* `MEMBER`, never a locked state.

### The rule that will bite us

**A mid-year salary increase past ₹15,000 does not change `pf_status`.** An existing `MEMBER` stays a `MEMBER` forever. An `EXCLUDED` employee whose salary rises stays `EXCLUDED` (they were excluded at joining; nothing about a raise pulls them in).

`pf_status` is therefore **set at hire and changed only by explicit HR action** — it must never be recomputed from current salary on each payroll run. A run that derives eligibility from this month's wage will silently enrol and un-enrol people as they get raises. Write the golden test for this (TR-60) before writing the engine.

### ESI

Same two gates, but the employee gate *is* wage-driven — with a twist that makes it stateful:

- Covered if `tenant.esi_registered` AND gross ≤ **₹21,000/month** (higher for employees with disability — SME to confirm the figure).
- **Contribution-period continuation:** coverage is fixed at the **start of the contribution period** (1 Apr–30 Sep, 1 Oct–31 Mar) and holds until that period **ends**, even if the wage crosses ₹21,000 mid-period. TRD TR-21 already notes this; the point here is that it means ESI coverage, like PF membership, **cannot be recomputed from the current month's wage.** It is a fact established at a point in time and carried forward.

---

## Golden test cases this creates (TR-60)

Non-negotiable, and cheap to write now:

1. Non-registered tenant → **no PF lines on any payslip.** Not zero. Absent.
2. Registered tenant, new joiner at ₹18,000 basic, no prior UAN → `EXCLUDED`, **no PF deducted.**
3. Same employee, HR opts them in → `MEMBER`, PF deducted from the opt-in month.
4. Registered tenant, new joiner at ₹18,000 basic, **has a UAN** → `MEMBER` (prior membership binds), PF deducted.
5. Existing `MEMBER` on ₹12,000 basic gets a raise to ₹20,000 → **still a `MEMBER`.** PF continues. (Ceiling restriction per D-10.)
6. `EXCLUDED` employee gets a raise → **still `EXCLUDED`.** No PF appears.
7. ESI: employee at ₹20,000 gross in April crosses to ₹22,000 in July → **stays covered through 30 September**, drops out from 1 October.
8. Tenant registers for EPF mid-year (`epf_registered_from`) → months before that date compute no PF; months after do.

Cases 5, 6 and 7 are the ones a wage-driven implementation gets wrong, and they are wrong *silently*.

---

## Consequences

- The employee master (Slice 1) grows `pf_status`, `esi_status`, `has_prior_pf_membership`, `pf_joining_wage`. **This is why it was worth fixing now** rather than in Phase 2 — the fields are cheap today and a backfill later.
- The Excel bulk import (CHR-09) must accept these columns, and must **not** guess them from salary. An import that infers `pf_status` from the wage column reintroduces the bug through the back door.
- Onboarding (CHR-04) must **ask** whether the employee has an existing UAN. HR will not volunteer it.
- Tenant setup (TR-02) must ask whether the company is EPF- and ESI-registered, and from when — it cannot be defaulted to true.

## Still open

- **D-10 (PF ceiling default):** restrict PF wage to ₹15,000, or compute on actual? TRD recommends tenant-electable, default restrict. The `pf_restrict_to_ceiling` field above supports a per-employee override; confirm with the SME whether that granularity is actually needed or whether tenant-level suffices.
- **Apprentices** (Apprentices Act) and **international workers** (no wage ceiling) are also excluded/special categories. Out of V1 scope, but `pf_status` is an enum precisely so these can be added without a migration.
