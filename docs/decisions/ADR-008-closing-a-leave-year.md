# ADR-008: Closing a Leave Year

- **Status:** Accepted
- **Date:** 9 November 2026
- **Context:** LVE-02, [OPEN.md D-25](OPEN.md) — due before 1 January 2027

---

## The problem

Balances are per calendar year (D-17, [ADR-007](ADR-007-leave-is-a-ledger.md)). With nothing at year end,
every balance starts the new year at zero. That is right for casual leave and wrong for earned leave, which
the Shops & Establishments Act lets people accumulate.

## Decision 1: two rules per leave type, applied carry → encash → lapse

Each paid leave type gets two pieces of data that HR edits:

| Column | Meaning |
|---|---|
| `carry_forward_max_hundredths` | The most of the closing balance that moves into the next year. `0` carries nothing; `NULL` has no limit. |
| `encash_max_hundredths` | Of what does not carry, the most set aside for payroll to pay out. |

Whatever is left after both lapses. The split is one pure function, `yearEndSplit` in
`packages/core/src/leave/year-end.ts`.

**Carry first.** A policy that offers both reads "keep up to N days, and we buy back up to M of the rest".
Encashing first would turn days the person could have kept into taxable pay they did not ask for.

**`NULL` (carry everything) is the column default,** so a type nobody has written a rule for keeps its days. The
seeded defaults lapse CL and SL and carry EL and ML in full. EL carries in full because the SME has not yet
named the Act's accumulation limit (D-21): a limit the company chooses is lawful, but lapsing earned leave the
Act protects is not. ML carries because 26 weeks granted in November run into January, and a request cannot
cross the new year.

**Encashment is recorded in days, never in money.** The rate is a Payroll Admin decision, and the payout is
PAY-08's, in Phase 2. Until then an `ENCASHMENT` entry is the record of what is owed, which a company pays
the way it pays salary today.

## Decision 2: a close writes ledger entries; a carry is two of them

Four new `leave_txn` kinds. All but one are written in the year being closed and bring it to zero:

| Kind | Year | Sign |
|---|---|---|
| `CARRY_OUT` | closing year | − |
| `CARRY_IN` | next year | + |
| `ENCASHMENT` | closing year | − |
| `LAPSE` | closing year | − |

A carry is two entries, not one, so that each year's sum is still that year's balance and no query has to
reach across years. Each entry carries the rule that made it as its reason ("2026 year end: Earned Leave
carries up to 30 days"), so the History button still answers "where did my days go?".

The sign check compares `kind::text`. Postgres refuses a check that names an enum value added in the same
transaction, and drizzle runs every pending migration in one transaction.

## Decision 3: a close is re-runnable and converges, rather than happening once

A close moves whatever the year *still* holds, within the room each limit has left after earlier closes of
that year. Closing twice with nothing new in between moves nothing. A late correction to the old year, or a
year closed out of order (closing 2025 after 2026 has been closed carries into 2026), is swept up by the next
close. We chose this over "exactly once per person and year" because that rule strands any days that arrive
after the close in a year nobody can use.

The cost is that the database cannot enforce "once" with a unique index, as it does for accruals and debits.
Instead, the close **locks every employee row first**, which is the same lock every other change to someone's
leave takes. That lock serialises a close against approvals, adjustments and a second close. The race test
carries the days twice with the lock removed (8 days instead of 4), and once with it.

## Decision 4: some balances are left where they are and reported

The close does not guess in three cases. It leaves the balance where it is and lists the person:

- **Leave still waiting for a decision** in the year. An approval after the close would debit days that had
  already moved on. Decide it, then close again. Only that leave type waits; the person's other types close.
- **An overdrawn balance.** A deficit is not carried into the new year. Recovering it, forgiving it or docking
  it as LOP is a decision for HR.
- **Someone who left during the year.** What they have is full-and-final settlement's to pay or recover
  (PAY-08). It should not be carried into a year they are not here for, nor lapsed before it is settled.

## Decision 5: missing credits are posted first, and a preview is a rolled-back close

Closing year Y first posts any accruals and grants for Y that are missing, using the same function as **Post
credits**. Otherwise December's earned-leave credit, posted after the close, would land in a year that has
already been emptied.

A close is refused until the year has ended in IST, because leave on 31 December is debited from that year. A
**preview** is allowed at any time, including for the year still running, which is when HR will look. It runs
the very same close inside a transaction and rolls it back. A preview therefore cannot disagree with the close
it previews, at the cost of briefly locking the company's leave while it runs.

Closing needs `leave.manage` **and** `leave.view.all`. It moves everyone's balance and lists people by name,
so an admin scoped to a team must not be able to read every balance through it.

## Consequences

- **Run by hand for now**, from Leave policy → Close the leave year, like accruals. The worker can run the same
  service on 1 January without new code, because the close is idempotent.
- **Companies created before this change** have `NULL` (carry everything) on every existing type, CL and SL
  included, because the migration does not backfill data. The preview shows it, and HR sets the rule. (The
  backfill was skipped deliberately: migrations run as the table owner, and under `FORCE ROW LEVEL SECURITY`
  a non-superuser owner's `UPDATE` would match no rows and do nothing, silently.)
- **A late approval in a closed year finds a zero balance** and is refused as "not enough balance". The fix
  is the third skip above: close only after the year's requests are decided.
- **Carry is uncapped across years.** A limit applies to what moves out of one year. There is no "maximum
  accumulated balance" separate from it. If the SME's reading of the Act needs one, it is a third column.
