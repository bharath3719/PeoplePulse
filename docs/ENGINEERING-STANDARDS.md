# Engineering Standards

Binding for all PeoplePulse code. The point is that a stranger — or you, in eight months, during payroll week at 11pm — can find things and change them safely.

Anything here can be argued with. Argue *before* you deviate, and update this doc when you win.

---

## 0. The two rules that are not style

Everything else in this document is a preference. These two are correctness, and BRD §10 makes violating them a **Sev-1**.

1. **Money is integer paise inside `packages/payroll`, and `NUMERIC(14,2)` in Postgres.** Never `double precision`, never a bare JS `number` for currency. Rupees exist only at the display and file-export boundary. Rounding is always an explicit named call — never incidental float behaviour. See [ADR-005](decisions/ADR-005-data-layer.md).

2. **Every query runs inside a tenant-scoped transaction, with `SET LOCAL`.** Never session scope — a pooled connection will leak one company's data into another company's request, silently. The repository layer owns this; no code reaches the DB around it. See [ADR-005](decisions/ADR-005-data-layer.md) D-2.

---

## 1. Role-Based Access Control

> *"We have lots of roles here. I don't want to see `if` conditions all over the application."*

Agreed, and the fix is a single idea: **code never checks roles. Code checks permissions.**

A role is a *bag of permissions*, and it is data — it lives in the database, it differs per tenant (ADM-01 requires custom roles), and it changes without a deploy. A permission is a *capability*, and it is a constant the code can name.

The moment you write `if (user.role === 'HR_ADMIN')`, you have hardcoded a business rule into a branch, and you will write it 400 more times.

### The permission registry — one source of truth

`packages/core/src/rbac/permissions.ts` defines every permission in the system, once. Both the API and the web app import it, so a typo is a compile error rather than a silent security hole.

```ts
export const PERMISSIONS = {
  'employee.view':          'View employee profiles',
  'employee.edit':          'Create and edit employees',
  'employee.delete':        'Delete employees',
  'employee.salary.view':   'View salary — SENSITIVE',
  'payroll.run.create':     'Create a payroll run',
  'payroll.run.finalize':   'Finalize payroll — IRREVERSIBLE',
  // …
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

### API — declarative, on the handler

```ts
// ✅ the check is metadata; the handler contains only business logic
@Post('runs/:id/finalize')
@RequirePermission('payroll.run.finalize')
finalize(@Param('id') id: string) {
  return this.payroll.finalize(id);
}

// ❌ never
if (user.role === 'PAYROLL_ADMIN' || user.role === 'SUPER_ADMIN') { … }
```

A single `PermissionGuard` reads the decorator and enforces it. There is exactly **one** place in the codebase that compares a user's permissions to a required one.

### Field-level sensitivity — in the serializer, not the handler

ADM-01 requires salary to be hidden from users who may not see it. That is **not** the handler's job — if it were, every endpoint returning an employee would need to remember, and one day one of them won't.

```ts
class EmployeeDto {
  @Expose() name: string;
  @Expose() @RequiresPermission('employee.salary.view') ctcAnnual: Paise;
  //         ^ absent from the response entirely if the caller lacks it
}
```

Redaction happens **once**, in the serialization layer. An endpoint author cannot forget it, because they were never asked to remember it.

### Web — a component and a hook, never a conditional on role

```tsx
// ✅
<Can I="payroll.run.finalize">
  <Button onClick={finalize}>Finalize payroll</Button>
</Can>

const { can } = usePermissions();
const columns = [ …, can('employee.salary.view') && salaryColumn ].filter(Boolean);

// ❌ never
{user.role === 'HR_ADMIN' && <Button>…</Button>}
```

### Non-negotiable

**The UI check is UX, not security.** `<Can>` hides a button the user cannot use. It does not protect anything — the API guard does, and RLS backstops *that*. Never let a UI check be the only thing between a user and an action.

### Adding a permission

Add it to the registry → grant it to the seeded roles that should have it → use it. Three steps, no branching, no `if`.

---

## 2. Project structure

```
apps/
  api/     NestJS. One module per bounded context.
  worker/  BullMQ consumers. Shares domain code with api.
  web/     React + Vite.
  mobile/  React Native (Phase 1.5).
packages/
  core/    Permissions, tenant context, audit, shared types + zod schemas.
  db/      Drizzle schema, migrations, RLS policies, repositories.
  payroll/ Statutory engine. Pure — no I/O, no DB, no clock.
```

**`packages/payroll` imports nothing from `api` or `db`.** It takes numbers in and returns numbers out. That is what makes 200 golden test cases (TR-60) possible to write and fast to run, and it is why the module that carries the most risk is the easiest to test.

### API module layout — same shape every time

```
apps/api/src/modules/employee/
  employee.controller.ts   HTTP. Thin. Validates, delegates, serializes.
  employee.service.ts      Business logic. The only place rules live.
  employee.repository.ts   DB access. The only place SQL lives.
  employee.dto.ts          Request/response shapes (zod + serializer).
  employee.module.ts
```

Controllers do not contain business logic. Services do not contain SQL. Repositories do not contain rules. When you are unsure where something goes, that ordering answers it.

---

## 3. Frontend

### Feature folders, not type folders

```
apps/web/src/features/employee/
  api/          queries + mutations (TanStack Query)
  components/   presentational
  hooks/        useEmployeeFilters, useEmployeeImport…
  employee.css  module styles (see below)
  routes/
```

Group by **feature**, not by file type. A `components/` directory containing 200 unrelated components is a filing cabinet, not architecture.

### Styling — Tailwind, and a stylesheet when Tailwind stops helping

We use Tailwind, so utility classes in `className` are **not** "inline styling" and are fine. What is banned:

```tsx
// ❌ style={{ … }} — banned. Not themeable, not overridable, not greppable.
<div style={{ display: 'flex', padding: 12, color: '#333' }} />

// ✅ utilities
<div className="flex gap-3 p-3 text-slate-700" />
```

When a class list gets long, repeats, or encodes something meaningful, **promote it** — do not copy it. Either extract a component, or, for a module with genuinely bespoke styling, a colocated stylesheet:

```
features/payroll/payroll.css   ← imported only by the payroll feature
```

Global tokens live in `apps/web/src/styles/` — **colour, spacing, and type scale are defined once** in the Tailwind config. Never a raw hex code in a component; it becomes eight slightly different greys across eight modules over twelve months.

### Hooks — extract on the second use, not the first

A hook per concern, in the feature that owns it. Promote to `src/hooks/` only when a *second* feature needs it. Premature sharing is as expensive as duplication, and harder to undo.

Rules of thumb, not laws:
- Component over ~200 lines → it is doing two things.
- More than ~3 `useState` in one component → it wants a `useReducer` or a hook.
- Data fetching **never** lives in a component. It lives in `api/`, wrapped in a TanStack Query hook.

### Server state vs client state

TanStack Query owns everything from the server. Do not copy server data into `useState` — that is a cache with no invalidation, and it will show a stale payroll total to somebody.

---

## 4. Shared code

> *"Commonly used functions in a common file."*

Yes — with one caveat that matters more than the rule: **shared ≠ dumped**. A `utils.ts` that accumulates 60 unrelated functions is a landfill, and everything imports it, so nothing can be changed.

Shared code is grouped by **what it is about**:

```
packages/core/src/
  money/       paise ↔ rupee, formatting, rounding      ← ONE place
  date/        IST handling, financial year, leave year ← ONE place
  validation/  zod schemas shared by api + web          ← ONE place
  rbac/        the permission registry
```

**Rule of three.** First use: write it inline. Second use: copy it and feel bad. Third use: extract it. Two call sites is not yet a pattern — extracting there tends to produce an abstraction fitted to a coincidence.

**Anything to do with money, dates, or PF/ESI eligibility is exempt from the rule of three — extract it on the first use.** Those are the three places where a duplicated, slightly-divergent implementation is a compliance defect rather than a mess. There is one function that converts paise to rupees. There is one function that decides which financial year a date is in. There is one function that answers "is this employee a PF member" ([ADR-004](decisions/ADR-004-statutory-applicability.md)), and it is never inlined as a wage comparison.

---

## 5. Naming, types, errors

- **Say what it is.** `payableDays`, not `days`. `netPayPaise`, not `amount`. A variable called `data` in a payroll function is a bug waiting for a reader.
- **Money variables carry their unit in the name:** `basicPaise`, `ctcAnnualPaise`. Reviewers cannot see a type, but they can see a name.
- `any` is banned outside test fixtures. `unknown` plus a zod parse at the boundary instead.
- **Validate at the edges.** Every request body is parsed by a zod schema shared with the client — the schema is the contract, written once.
- Errors are RFC 7807 `problem+json` (TR-40). Never leak a stack trace or a DB error to a client.
- **Never `console.log`.** Structured logging with `tenant_id` correlation (TRD §10) — and never log salary, PAN, or bank data. A log file is a data breach in waiting.

---

## 6. Testing

Load the tests where the risk is. The payroll engine is not "70% covered" — it is exhaustively covered, because BRD R1 says a wrong number there is a customer's penalty.

| What | Standard |
|---|---|
| `packages/payroll` | **Golden fixtures, SME-signed** (TR-60). Every statute, every boundary. A diff is a release blocker. |
| Domain services | ≥ 70% (TR-63) |
| Tenant isolation | Every module gets a test that **tries** to read across tenants and fails (TR-62) — including one that runs **through the pooler**, since a direct-connection test passes while production is broken |
| E2E | The journeys that earn money: punch→lock→payroll→payslip; apply-leave→approve; candidate→hire→onboard |

Write the test that proves the *bug you're afraid of*, not the test that proves the happy path you just wrote.

---

## 7. Git

- Trunk-based. Short-lived branches. Small PRs — a 2,000-line PR is not reviewed, it is waved through.
- Conventional commits: `feat(payroll): …`, `fix(attendance): …`.
- **Any PR touching `packages/payroll` requires the golden suite green and a second reviewer.** No exceptions during payroll week (NFR-01 change freeze, 25th–5th).

---

## 8. Comments

Comment the **why**, never the what. The code says what it does.

```ts
// ❌ increment the counter
i++;

// ✅ EPS is capped at the ₹15,000 wage ceiling even when actual PF wage is higher —
// EPF & MP Act. The remainder of the employer's 12% goes to EPF, not EPS.
const epsPaise = min(pfWagePaise, CEILING_PAISE) * EPS_RATE;
```

Statutory logic gets a comment naming **the rule it implements**, because the next reader cannot be assumed to know the EPF Act — and because when the rate changes at the next budget, they need to find every place that depends on it.
