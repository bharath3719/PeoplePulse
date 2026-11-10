import { and, asc, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { employee, leaveTxn, leaveType, type TenantDatabase } from '@peoplepulse/db';
import {
  dayHundredths, istDate, lastDayOfMonth, monthlyAccrual, payrollMonth, yearlyGrant,
  type Actor, type LeaveYear, type PayrollMonth, type Tenure,
} from '@peoplepulse/core';

/** Postgres takes at most 65,535 bind parameters per statement; a ledger row uses 8. */
const INSERT_BATCH = 1_000;

/**
 * Post a leave year's accruals and grants, up to and including `through`, in
 * the caller's transaction (TR-15). Posting credits by hand and closing a year
 * both start here, so they cannot disagree about what was earned.
 *
 * IDEMPOTENT, and catching up: every month of the year up to `through` that is
 * missing a credit gets one, and none gets two — the ledger's unique index on
 * (employee, type, period) turns a repeat into a no-op. So posting October
 * after forgetting September posts both, and posting it twice posts once.
 *
 * Credits are computed from today's join and exit dates and today's
 * entitlement. One already posted is not recomputed when either changes later
 * (OPEN.md D-24).
 */
export async function postCredits(
  tx: TenantDatabase, actor: Actor, through: PayrollMonth,
): Promise<{ posted: number; alreadyPosted: number }> {
  const year = Number(through.slice(0, 4)) as LeaveYear;
  const lastMonth = Number(through.slice(5, 7));

  // Both in id order, so the rows go in in the same order every time: two runs
  // posting at once then meet on the first row and queue, rather than each
  // holding a row the other wants next and deadlocking.
  const types = await tx.select().from(leaveType).where(and(
    eq(leaveType.isActive, true),
    eq(leaveType.isPaid, true),
    ne(leaveType.accrualFrequency, 'NONE'),
  )).orderBy(asc(leaveType.id));

  const people = await tx.select({ id: employee.id, joinDate: employee.joinDate, exitDate: employee.exitDate })
    .from(employee)
    .where(and(
      isNull(employee.deletedAt),
      lte(employee.joinDate, lastDayOfMonth(through)),
      or(isNull(employee.exitDate), gte(employee.exitDate, `${year}-01-01`)),
    ))
    .orderBy(asc(employee.id));

  const rows: (typeof leaveTxn.$inferInsert)[] = [];
  for (const person of people) {
    const tenure: Tenure = {
      joinDate: istDate(person.joinDate),
      exitDate: person.exitDate ? istDate(person.exitDate) : null,
    };
    const credit = (kind: 'GRANT' | 'ACCRUAL', period: string, amount: number, typeId: string) => {
      if (amount > 0) {
        rows.push({
          tenantId: actor.tenantId, employeeId: person.id, leaveTypeId: typeId,
          calendarYear: year, kind, daysHundredths: amount, accrualPeriod: period, createdBy: actor.userId,
        });
      }
    };

    for (const type of types) {
      const annual = dayHundredths(type.annualEntitlementHundredths);
      if (type.accrualFrequency === 'YEARLY') {
        credit('GRANT', String(year), yearlyGrant(annual, year, tenure, type.proRataOnJoin), type.id);
      } else {
        for (let m = 1; m <= lastMonth; m += 1) {
          const month = payrollMonth(`${year}-${String(m).padStart(2, '0')}`);
          credit('ACCRUAL', month, monthlyAccrual(annual, month, tenure), type.id);
        }
      }
    }
  }

  let posted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const inserted = await tx.insert(leaveTxn).values(rows.slice(i, i + INSERT_BATCH))
      .onConflictDoNothing()
      .returning({ id: leaveTxn.id });
    posted += inserted.length;
  }

  return { posted, alreadyPosted: rows.length - posted };
}

/** Insert ledger rows in batches that stay under Postgres's bind-parameter limit. */
export async function insertLedgerRows(tx: TenantDatabase, rows: (typeof leaveTxn.$inferInsert)[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await tx.insert(leaveTxn).values(rows.slice(i, i + INSERT_BATCH));
  }
}
