import { describe, it, expect } from 'vitest';
import { fromRupees } from '../money/paise';
import {
  derivePfStatusAtHire, optIntoPf, pfStatusAfterSalaryChange,
  deriveEsiStatusAtPeriodStart, shouldComputePf, shouldComputeEsi,
} from './pf-eligibility';

/**
 * The eight golden cases from ADR-004. Cases 5, 6 and 7 are the ones a
 * wage-driven implementation gets wrong — silently, while looking correct.
 */

const REGISTERED = { epfRegistered: true, esiRegistered: true };
const NOT_REGISTERED = { epfRegistered: false, esiRegistered: false };

describe('gate 1 — is the establishment registered?', () => {
  it('CASE 1: a non-registered company gives nobody PF', () => {
    // Our segment starts at 10 employees; EPF is mandatory only at 20+.
    // "Not registered" is a correct, common state — not a misconfiguration.
    const status = derivePfStatusAtHire(NOT_REGISTERED, {
      pfWageAtJoining: fromRupees(12_000),
      hasPriorPfMembership: true, // even a prior member gets nothing here
    });

    expect(status).toBe('NOT_APPLICABLE');
    expect(shouldComputePf(status)).toBe(false);
  });

  it('CASE 8: a company that registers mid-year has no PF before that date', () => {
    // Modelled by `tenant.epfRegisteredFrom` at the payroll layer; the
    // establishment profile passed in is the one effective for the run's month.
    const beforeRegistration = derivePfStatusAtHire(NOT_REGISTERED, {
      pfWageAtJoining: fromRupees(12_000), hasPriorPfMembership: false,
    });
    const afterRegistration = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(12_000), hasPriorPfMembership: false,
    });

    expect(beforeRegistration).toBe('NOT_APPLICABLE');
    expect(afterRegistration).toBe('MEMBER');
  });
});

describe('gate 2 — is this employee a member?', () => {
  it('CASE 2: a new joiner above the ceiling with no prior PF is EXCLUDED', () => {
    const status = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(18_000), // > Rs 15,000
      hasPriorPfMembership: false,
    });

    expect(status).toBe('EXCLUDED');
    expect(shouldComputePf(status)).toBe(false); // no PF deducted
  });

  it('CASE 3: an excluded employee can opt in, and then contributes', () => {
    // Para 26(6): by mutual agreement. EXCLUDED is a default, not a lock.
    const excluded = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(18_000), hasPriorPfMembership: false,
    });
    expect(excluded).toBe('EXCLUDED');

    const optedIn = optIntoPf(excluded);
    expect(optedIn).toBe('MEMBER');
    expect(shouldComputePf(optedIn)).toBe(true);
  });

  it('CASE 4: prior membership BINDS — a UAN holder above the ceiling is still a MEMBER', () => {
    // The clause most often missed. A senior hire on Rs 80,000 basic who has an
    // existing UAN is a member, and PF must be deducted.
    const status = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(80_000),
      hasPriorPfMembership: true,
    });

    expect(status).toBe('MEMBER');
    expect(shouldComputePf(status)).toBe(true);
  });

  it('joins at exactly the ceiling — Rs 15,000 is IN, not out', () => {
    // Boundary. "Above Rs 15,000" excludes; exactly Rs 15,000 does not.
    expect(derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(15_000), hasPriorPfMembership: false,
    })).toBe('MEMBER');

    expect(derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(15_000.01), hasPriorPfMembership: false,
    })).toBe('EXCLUDED');
  });

  it('refuses to opt someone in at a company with no PF scheme', () => {
    expect(() => optIntoPf('NOT_APPLICABLE')).toThrow(/not EPF-registered/i);
  });
});

describe('the trap — a raise must NOT change PF status', () => {
  it('CASE 5: a MEMBER who crosses the ceiling STAYS a member', () => {
    // Joined on Rs 12,000 basic -> member. Promoted to Rs 20,000.
    // A wage-driven implementation ejects them here and silently stops
    // deducting PF from someone who is legally still in the scheme.
    const atHire = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(12_000), hasPriorPfMembership: false,
    });
    expect(atHire).toBe('MEMBER');

    const afterRaise = pfStatusAfterSalaryChange(atHire);

    expect(afterRaise).toBe('MEMBER');
    expect(shouldComputePf(afterRaise)).toBe(true); // PF continues. Once in, always in.
  });

  it('CASE 6: an EXCLUDED employee who gets a raise STAYS excluded', () => {
    const atHire = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(18_000), hasPriorPfMembership: false,
    });
    expect(atHire).toBe('EXCLUDED');

    expect(pfStatusAfterSalaryChange(atHire)).toBe('EXCLUDED');
  });

  it('an EXCLUDED employee whose wage DROPS below the ceiling is still excluded', () => {
    // The mirror image, and the one a "recompute every month" engine gets wrong:
    // it would silently enrol them the moment a wage revision drops them under
    // Rs 15,000. Exclusion was decided at joining.
    const excluded = derivePfStatusAtHire(REGISTERED, {
      pfWageAtJoining: fromRupees(18_000), hasPriorPfMembership: false,
    });

    expect(pfStatusAfterSalaryChange(excluded)).toBe('EXCLUDED');
  });
});

describe('ESI — coverage is fixed at the contribution-period start', () => {
  it('covers an employee at or below Rs 21,000', () => {
    expect(deriveEsiStatusAtPeriodStart(REGISTERED, fromRupees(20_000))).toBe('COVERED');
    expect(deriveEsiStatusAtPeriodStart(REGISTERED, fromRupees(21_000))).toBe('COVERED');
    expect(deriveEsiStatusAtPeriodStart(REGISTERED, fromRupees(21_000.01))).toBe('NOT_COVERED');
  });

  it('gives nobody ESI at a non-registered company', () => {
    expect(deriveEsiStatusAtPeriodStart(NOT_REGISTERED, fromRupees(15_000)))
      .toBe('NOT_APPLICABLE');
  });

  it('CASE 7: coverage HOLDS when the wage crosses mid-period', () => {
    // Covered in April at Rs 20,000. Raised to Rs 22,000 in July.
    // They remain covered until 30 September — the period end — and only then
    // drop out. Status is decided at the period start and carried, never
    // recomputed from the current month.
    const atAprilStart = deriveEsiStatusAtPeriodStart(REGISTERED, fromRupees(20_000));
    expect(atAprilStart).toBe('COVERED');
    expect(shouldComputeEsi(atAprilStart)).toBe(true); // still true in July

    // The NEXT period (from 1 October) is assessed afresh, on the new wage.
    const atOctoberStart = deriveEsiStatusAtPeriodStart(REGISTERED, fromRupees(22_000));
    expect(atOctoberStart).toBe('NOT_COVERED');
  });
});
