import { describe, it, expect } from 'vitest';
import {
  paise, fromRupees, parseRupees, toRupees, formatRupees, formatINR,
  add, subtract, times, percentOf, prorate, fraction, min, max,
  atLeastZero, roundToNearestRupee, basisPoints, MoneyError, ZERO,
} from './paise';

// Statutory rates, exactly representable in basis points.
const EPF_RATE = basisPoints(1200);      // 12%
const EPS_RATE = basisPoints(833);       // 8.33%
const ESI_EMPLOYEE = basisPoints(75);    // 0.75%
const ESI_EMPLOYER = basisPoints(325);   // 3.25%
const PF_CEILING = fromRupees(15_000);

describe('construction', () => {
  it('rejects a non-integer paise value, because that is always a bug', () => {
    expect(() => paise(100.5)).toThrow(MoneyError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => paise(NaN)).toThrow(MoneyError);
    expect(() => paise(Infinity)).toThrow(MoneyError);
  });

  it('converts rupees at the boundary', () => {
    expect(fromRupees(30_000)).toBe(3_000_000);
    expect(fromRupees(1249.5)).toBe(124_950);
  });

  it('survives the float values that motivated this module', () => {
    // 43758.35 * 100 === 4375834.999999999 in raw float.
    expect(fromRupees(43_758.35)).toBe(4_375_835);
    // 0.1 + 0.2 territory
    expect(fromRupees(0.1) + fromRupees(0.2)).toBe(fromRupees(0.3));
  });

  it('parses spreadsheet and form input, and rejects junk', () => {
    expect(parseRupees('₹1,23,456.78')).toBe(12_345_678);
    expect(parseRupees('30000')).toBe(3_000_000);
    expect(() => parseRupees('abc')).toThrow(MoneyError);
    expect(() => parseRupees('100.567')).toThrow(MoneyError); // sub-paisa precision
  });
});

describe('statutory arithmetic', () => {
  it('computes employee PF at 12% of PF wage', () => {
    const pfWage = fromRupees(30_000);
    expect(percentOf(pfWage, EPF_RATE)).toBe(fromRupees(3_600));
  });

  it('computes EPS at 8.33% of the ceiling, not the actual wage', () => {
    // TRD TR-21 worked example: PF wage 30,000, but EPS is capped at 15,000.
    const pfWage = fromRupees(30_000);
    const epsBase = min(pfWage, PF_CEILING);
    const eps = percentOf(epsBase, EPS_RATE);

    expect(eps).toBe(fromRupees(1_249.5));           // 8.33% of 15,000
    expect(roundToNearestRupee(eps)).toBe(fromRupees(1_250)); // EPFO wants whole rupees

    // Employer's 12% splits: EPS takes its cut, EPF gets the remainder.
    const employerTotal = percentOf(pfWage, EPF_RATE);
    const employerEpf = subtract(employerTotal, roundToNearestRupee(eps));
    expect(employerEpf).toBe(fromRupees(2_350));     // matches the TRD fixture
  });

  it('computes ESI at 0.75% / 3.25%', () => {
    const gross = fromRupees(20_000);
    expect(percentOf(gross, ESI_EMPLOYEE)).toBe(fromRupees(150));
    expect(percentOf(gross, ESI_EMPLOYER)).toBe(fromRupees(650));
  });
});

describe('the gratuity case — the reason this module exists', () => {
  it('does not lose a paisa to float truncation', () => {
    // Payment of Gratuity Act: 15/26 x last drawn basic+DA x completed years.
    // In raw float this is 196874.99999999997 — and Math.floor() on that
    // silently yields 196874.99, one paisa short.
    const lastBasic = fromRupees(48_750);
    const years = 7;

    const gratuity = times(fraction(lastBasic, 15, 26), years);

    expect(gratuity).toBe(fromRupees(196_875));   // exact. not 196874.99.
    expect(toRupees(gratuity)).toBe(196_875);

    // Prove the float path actually was wrong, so this test documents WHY:
    const naive = (15 / 26) * 48_750 * 7;
    expect(naive).not.toBe(196_875);
    expect(Math.floor(naive * 100)).toBe(19_687_499);  // <- the paisa we would have lost
    expect(gratuity).toBe(19_687_500);
  });
});

describe('pro-rata (TR-20 step 3)', () => {
  it('pro-rates a monthly component by payable days', () => {
    const monthly = fromRupees(30_000);
    expect(prorate(monthly, 17, 31)).toBe(fromRupees(16_451.61));
  });

  it('returns the full amount for a full month', () => {
    const monthly = fromRupees(30_000);
    expect(prorate(monthly, 31, 31)).toBe(monthly);
  });

  it('refuses to divide by zero rather than returning Infinity', () => {
    expect(() => prorate(fromRupees(100), 1, 0)).toThrow(MoneyError);
  });
});

describe('guards', () => {
  it('clamps deductions so they cannot become earnings', () => {
    expect(atLeastZero(paise(-500))).toBe(ZERO);
    expect(atLeastZero(paise(500))).toBe(500);
  });

  it('rounds half away from zero, including for recoveries', () => {
    expect(roundToNearestRupee(fromRupees(10.5))).toBe(fromRupees(11));
    expect(roundToNearestRupee(fromRupees(-10.5))).toBe(fromRupees(-11));
  });
});

describe('formatting — Indian digit grouping', () => {
  it('groups in lakhs and crores, not thousands', () => {
    expect(formatRupees(fromRupees(1_234_567.89))).toBe('12,34,567.89');
    expect(formatRupees(fromRupees(1_000))).toBe('1,000.00');
    expect(formatRupees(fromRupees(100))).toBe('100.00');
    expect(formatINR(fromRupees(45_000))).toBe('₹45,000.00');
  });

  it('formats negatives', () => {
    expect(formatRupees(fromRupees(-1_500.5))).toBe('-1,500.50');
  });
});

describe('sums do not drift', () => {
  it('adds a workforce-sized set of components exactly', () => {
    const values = Array.from({ length: 200 }, (_, i) => fromRupees(1_817.35 + i * 0.01));
    const total = add(...values);

    // Reconciliation: the sum of components must EQUAL gross. With floats this
    // comparison is the one that spuriously fails and tempts someone to write
    // `Math.abs(a - b) < 0.01` — which is how a real error gets hidden.
    const expected = values.reduce<number>((acc, v) => acc + v, 0);
    expect(total).toBe(expected);
    expect(Number.isInteger(total)).toBe(true);
  });
});
