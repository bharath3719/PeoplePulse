# ADR-005: Data Layer — Money, RLS, ORM, Auth

- **Status:** Accepted
- **Date:** 13 July 2026
- **Resolves:** [OPEN.md](OPEN.md) D-1, D-2, D-3, D-5 — the last four blockers on Slice 1.

Four engineering calls, taken so the build can start. All four are reversible in Slice 1 and expensive later, which is why they are being fixed now rather than discovered.

---

## D-1 — Money

**Postgres: `NUMERIC(14,2)`. Never `double precision`.**
**TypeScript: integer paise inside `packages/payroll`.** Rupees exist only at the display and file-export boundary.

The Product Lead's instinct — that float is fine — is *mostly right*, and it is worth recording why we are not taking it. Float was tested against real payroll arithmetic: PF at 12%, ESI, EPS at 8.33% of the ceiling, and pro-rata division across 50,000 wage values. **Zero disagreements with exact arithmetic.** Ordinary payroll maths does not break float.

It breaks here:

```
gratuity, 15/26 × 48750 × 7  =  196874.99999999997     (true answer: 196875)
  Math.round(x × 100)        =  19687500 paise  ✓
  Math.floor(x × 100)        =  19687499 paise  ✗      one paisa short, silently
```

The failure is not in the maths. It is in the *next* person to touch the code, who writes `Math.floor` — an entirely natural reach when you want "no fractional paise" — and loses a paisa in a PF filing. Integer paise makes that unrepresentable. It costs about a day. BRD §10 makes statutory errors Sev-1.

The database column is the non-negotiable half and is free either way: money in a float column drifts across every read-modify-write, and no amount of careful TypeScript recovers it.

**Enforcement:** a branded `Paise` type, and a lint rule banning bare arithmetic operators on it inside `packages/payroll`. Rounding is always an explicit named function (`roundToNearestRupee`), never incidental float behaviour.

> Reversible on one line from the Product Lead. The evidence is above; the call was mine.

### Amendment, 13-Jul — storage type

**Money is `BIGINT` paise in Postgres, not `NUMERIC(14,2)`.** Both are exact, so this is not about precision.

`NUMERIC` is returned by the Postgres driver as a **string** — to avoid silently truncating values that exceed a JS double — which would have to be parsed to a number on *every read*. That re-introduces the exact float boundary we removed. `BIGINT` maps 1:1 onto the `Paise` type with no conversion at all. (Our amounts are nowhere near the safe-integer limit: a crore of rupees is 10¹¹ paise; `Number.MAX_SAFE_INTEGER` is 9×10¹⁵.)

---

## D-2 — RLS under a connection pooler

**Tenant context is set with `SET LOCAL`, inside an explicit transaction, on every request. Never at session scope.**

This is a correctness fix to TRD TR-01, not a preference. TR-01 as written sets `app.current_tenant` on the **session**. Under a transaction-mode pooler (PgBouncer, RDS Proxy) sessions are recycled between requests — so one tenant's context can survive into another tenant's request. That is the precise cross-tenant leak RLS exists to prevent (NFR-07), and it fails **silently**.

The repository layer owns this. No query runs outside a tenant-scoped transaction.

**TR-62's isolation suite must include a case that runs through the pooler,** not only against a direct connection. A direct-connection test passes while production is broken — which is the worst possible test.

## D-3 — ORM

**Drizzle.**

Payroll and statutory-register queries are complex and we want to read the SQL we ship; Prisma's generated queries and weaker raw-SQL story fight that. Drizzle is also the lightest fit with the `SET LOCAL` transaction discipline D-2 requires.

**One thing to prove in the first week, not assume:** that Drizzle's transaction API cleanly carries `SET LOCAL` tenant context through the connection pool. This is the single differentiator that matters between the ORM candidates. If it does not, revisit — the decision is cheap to reverse before there is a schema.

## D-5 — Auth

**Build it, per TRD TR-50** — Argon2id, JWT (15-min access + rotating refresh), TOTP MFA for Super Admin and Payroll Admin, Redis revocation list.

The TRD already specified this; it was never really open. Buying was worth a look because auth is security-critical surface a lean team then owns forever — but data residency (NFR-06) constrains which vendors could even hold the data in an Indian region, and the TRD's spec is standard and well-trodden.

**Extended by [ADR-004's](ADR-004-statutory-applicability.md) sibling decision, D-16:** the JWT carries the **active** `tenant_id`, resolved from the `user_tenant` join table. Switching company re-issues the token. RLS is unchanged — still exactly one tenant per request.

---

## What this unblocks

Slice 1 has no remaining blockers. Still open, none of them blocking: the internal support console (D-18), employee-code generation (D-19), cloud region and object storage (D-6, D-7), and the Phase-3 vendor questions (D-8, D-11, D-12, D-13).
