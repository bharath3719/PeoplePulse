# ADR-006: RLS Is Worthless Without an Unprivileged Database Role

- **Status:** Accepted — **and already caught a live cross-tenant write**
- **Date:** 13 July 2026
- **Found by:** the tenant-isolation suite (TR-62), on its first run against a real database.

---

## What happened

We built the tenant isolation described in [ADR-005](ADR-005-data-layer.md) and the TRD:

- ✅ `tenant_id` on every tenant-owned row
- ✅ RLS policies with both `USING` and `WITH CHECK` on all 11 tables
- ✅ `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on all 11
- ✅ transaction-scoped tenant context via `set_config(..., is_local => true)` — the D-2 fix
- ✅ a migration that verified all of the above and printed **`✓ RLS enforced on 11 tenant-owned tables`**

Then the isolation suite ran, and one company **successfully inserted a row into another company's data.** Reads leaked too. A query with no tenant context returned every row in the table.

Everything above was correct. Isolation was zero.

## Why

**The application was connecting as `postgres`.**

PostgreSQL superusers — and any role carrying `BYPASSRLS` — do not merely *pass* row-level security checks. **The policies are never evaluated at all.** RLS is skipped wholesale.

`FORCE ROW LEVEL SECURITY` does not save you. It closes a *different* gap — it makes RLS apply to the table's **owner**, who is otherwise exempt. It has no effect on a superuser.

And nothing in the schema can tell you this is happening. `pg_class.relrowsecurity` is `true`. `pg_class.relforcerowsecurity` is `true`. Every policy is present and correct. Our own migration check inspected exactly those columns and reported success. **The schema was perfect and the guarantee was absent**, because the property that actually matters is a fact about the *connecting role*, not about the tables.

This is a near-perfect trap:

- `postgres` is the default superuser in every local install, every quickstart, and most Docker composes.
- Everything appears to work — you are reading and writing your own tenant's data, so nothing looks wrong.
- No error, no warning, no log line.
- A test suite that only checks the happy path passes **green**, forever.

It would have shipped. It is the exact failure mode BRD risk **R4** (breach of PII: Aadhaar/PAN/salary) describes, and it would have been invisible until a customer saw another customer's payroll.

## Decision

**1. The application connects as `peoplepulse_app`: `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`.**

It holds `SELECT`/`INSERT`/`UPDATE`/`DELETE` on data and **no DDL whatsoever**. It cannot `ALTER TABLE`, cannot `DROP POLICY`, cannot turn RLS off. Migrations run as the owner; the app never does. Defined in `packages/db/src/rls/app-role.sql`.

**2. Two connection strings, permanently separated.**

```
MIGRATION_DATABASE_URL  -> postgres (owner). DDL only. Used by migrations.
DATABASE_URL            -> peoplepulse_app.  Data only. Used by the API and workers.
```

**3. `assertRlsEnforced()` runs at API boot and refuses to start if isolation is not real.**

It checks three things, and the *first* is the one that actually bites:

1. the connecting role is not a superuser and does not hold `BYPASSRLS`
2. RLS is `ENABLE`d on every tenant-owned table
3. RLS is `FORCE`d on every one

A failure is a hard stop, never a warning. A system that cannot isolate tenants must not accept traffic.

**4. The isolation suite runs as `peoplepulse_app`, never as the owner.**

Had it run as the owner it would have passed every assertion while proving nothing. A green suite that proves nothing is worse than a red one — it actively manufactures confidence.

## Consequences

- **Production must never hand the app a superuser connection string.** This is now the single most dangerous configuration mistake available in this system, and `assertRlsEnforced()` at boot is the only thing standing in front of it. It must never be downgraded to a warning.
- The purge path needs elevated privileges. The app role holds no `DELETE` grant on `audit_log` or `employee_event` at all — so the API **cannot** erase the audit trail even with a bug, even if compromised. Account closure (ADM-05) and retention purges run as a separate admin job. See `withPurgeMode()`.
- Append-only is enforced twice over, independently: by the **absent GRANT** (the app is refused before a trigger even runs) and by a **trigger** (which catches the owner, a migration, or a human at a `psql` prompt). Both had to be defeated for the audit log to be rewritten.

## The general lesson, worth carrying to Phase 2

**Every security control we build must be tested from the position of the attacker, using the same credentials production uses.** Not from the owner's seat, not with a superuser, not with mocks.

The payroll golden-test suite (TR-60) is the analogue: it must run against the real statutory engine with real fixtures, because a payroll test that stubs the PF calculation proves the stub works. This finding is the cheap version of that lesson. We got it for the price of one afternoon instead of one customer's penalty notice.
