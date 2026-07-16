# ADR-003: Frontend UI Stack (Web)

- **Status:** Accepted — **but see the amendment below; the primary rationale has changed.**
- **Date:** 13 July 2026
- **Context:** [TRD](../TRD.md) §2.2 specifies React + TypeScript + Vite + TanStack Query but names no component library. This fills that gap.
- **Scope:** Web only (`apps/web`). React Native cannot consume web component libraries, so the mobile UI kit is a separate, later decision.

---

## ⚠️ Amendment, 13-Jul-2026 — accessibility deprioritised

The Product Lead has **deprioritised WCAG 2.1 AA (BRD NFR-09) for now.** That was the deciding argument below, so the reasoning here no longer holds as written.

**The decision stands anyway,** on the remaining grounds: we own the component code outright, it is free at any team size (where MUI X Pro is not), and TanStack Table is the natural sibling of the TanStack Query already fixed by the TRD. Radix still provides the accessibility — we simply are no longer *relying* on it, and get it at no cost.

**What changes:** Ant Design is now genuinely the faster route to a first demo, since its dense `<Table>` needs no assembly. Not judged worth the churn to switch, but that trade is now real rather than foreclosed.

**NFR-09 is deferred, not deleted.** Retrofitting accessibility is materially more expensive than building with it. Choosing Radix means the door stays open at close to zero cost — which is the main reason not to churn.

---

## Decision

| Concern | Choice |
|---|---|
| Components | **shadcn/ui** — Radix UI primitives, copied into the repo rather than installed as a dependency |
| Styling | **Tailwind CSS** |
| Data grids | **TanStack Table** (headless) |
| Forms | **react-hook-form** + **zod** |
| Server state | **TanStack Query** (already fixed by TRD §2.2) |

Validation schemas are defined in `zod` and **shared between the API and the web client** via a monorepo package, so a field's rules are stated once.

## Rationale

Three properties of *this* product drove it:

**It is a dense data application.** Employee lists, attendance grids, payroll preview tables running to 200 rows and dozens of columns, salary and statutory registers. The table is the most-used component in the product and the one most likely to hit strange requirements. A headless grid (TanStack Table) means those requirements are ours to satisfy directly rather than to negotiate with a library's abstractions. It is also a natural sibling of the TanStack Query the TRD already committed to.

**WCAG 2.1 AA is a hard requirement** for the ESS web app (NFR-09), not an aspiration. Radix primitives are built to it — keyboard navigation, focus management, and ARIA semantics come from the primitive rather than from our discipline. This was the single strongest argument against Ant Design, whose dense `<Table>` is otherwise the best in the category.

**The forms are dynamic.** PMS review templates (TR-31) and per-tenant custom fields (CHR-10) are JSONB schemas rendered at runtime. That needs a composable form layer, which `react-hook-form` + `zod` gives us, rather than a fixed set of prebuilt form components.

Two secondary factors: shadcn/ui components are **copied into the repo, so we own them outright** — there is no library upgrade that can break the payroll grid, and no opinion we cannot override. And it is MIT and free at any team size, where MUI's X Pro DataGrid (column pinning, Excel export — both of which we will want for payroll registers) is a paid per-developer licence.

## Rejected alternatives

- **Ant Design** — genuinely the fastest route to a working HRMS console, and its dense table is best-in-class for exactly this category. Rejected on accessibility risk against NFR-09, plus a strong visual opinion that is hard to escape once embedded.
- **MUI** — mature with real accessibility. Rejected because the DataGrid features we will actually need for payroll registers sit behind a paid licence, and the Material look is recognisable.
- **Mantine** — a reasonable middle path with a free data table. Rejected only on ecosystem size; no answer when we hit an edge case at 2am during payroll week.

## Consequences

- **The first data table costs more than it would in AntD.** There is no batteries-included grid; we assemble sorting, filtering, pinning, and virtualisation on TanStack Table ourselves. Accepted deliberately — that cost is paid once, early, and bought back over every subsequent grid.
- We need a **design token layer** in Tailwind config from day one (spacing, colour, type scale) so that owning the components does not degrade into inconsistency across modules.
- shadcn components are **vendored, not versioned** — upstream fixes do not arrive automatically. We must record which components were pulled and when.
- Payroll and register grids are large; **virtualisation is required, not optional**, to meet the p95 < 2s page-load target (NFR-02).

## Still open

Mobile UI kit for `apps/mobile` (React Native Paper / Tamagui / NativeWind). Not needed until the ESS app in Phase 1.5. Tracked in [OPEN.md](OPEN.md).
