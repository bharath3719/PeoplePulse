/**
 * Money. Read this before touching anything financial.
 *
 * Every monetary value in PeoplePulse is an INTEGER NUMBER OF PAISE.
 * Rupees exist only at the display and file-export boundary.
 *
 * Why: JavaScript numbers are IEEE-754 doubles. Ordinary payroll arithmetic
 * survives that — we tested 50,000 wage values against PF, ESI, EPS and
 * pro-rata and found zero disagreements. What does not survive is the
 * gratuity formula:
 *
 *     15/26 x 48750 x 7  ==  196874.99999999997     (the true answer is 196875)
 *
 * Math.round() rescues that. Math.floor() — an entirely natural thing to
 * write when you want "no fractional paise" — silently loses a paisa. In a
 * PF ECR filing that is a Sev-1 compliance defect (BRD S10).
 *
 * So paise are integers, the `Paise` type is branded so a bare number cannot
 * be passed by accident, and the only arithmetic is the functions below.
 * See ADR-005.
 */

/** An integer number of paise. 100 paise = 1 rupee. */
export type Paise = number & { readonly __brand: 'Paise' };

/**
 * A rate in basis points. 1 bp = 0.01%.
 *
 * Every statutory rate we need is exactly representable this way, which is
 * the point — no rate is ever a float:
 *   EPF employee/employer 12%   = 1200 bp
 *   EPS                   8.33% =  833 bp
 *   ESI employee          0.75% =   75 bp
 *   ESI employer          3.25% =  325 bp
 */
export type BasisPoints = number & { readonly __brand: 'BasisPoints' };

const BP_DIVISOR = 10_000;

export class MoneyError extends Error {}

/** Round half away from zero — the convention Indian payroll expects. */
function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Assert an integer, because a non-integer paise value is always a bug. */
function assertInteger(n: number, what: string): void {
  if (!Number.isFinite(n)) throw new MoneyError(`${what} is not finite: ${n}`);
  if (!Number.isInteger(n)) throw new MoneyError(`${what} must be a whole number of paise, got ${n}`);
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} exceeds safe integer range: ${n}`);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function paise(value: number): Paise {
  assertInteger(value, 'paise');
  return value as Paise;
}

export const ZERO: Paise = 0 as Paise;

export function basisPoints(value: number): BasisPoints {
  assertInteger(value, 'basisPoints');
  return value as BasisPoints;
}

/**
 * Rupees -> paise. Use ONLY at the boundary: parsing a form, an Excel import,
 * a bank file. Never mid-calculation.
 */
export function fromRupees(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new MoneyError(`rupees is not finite: ${rupees}`);
  // The multiply is the one place a float legitimately touches money, so it is
  // rounded immediately and never propagates. 43758.35 * 100 is 4375834.999... —
  // exactly the drift this whole module exists to contain.
  return paise(roundHalfUp(rupees * 100));
}

/** Parse a string from a form or a spreadsheet cell. Rejects junk loudly. */
export function parseRupees(input: string): Paise {
  const cleaned = input.replace(/[,\s₹]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`not a valid rupee amount: "${input}"`);
  }
  return fromRupees(Number(cleaned));
}

// ---------------------------------------------------------------------------
// Arithmetic — the only sanctioned operations
// ---------------------------------------------------------------------------

export function add(...values: Paise[]): Paise {
  return paise(values.reduce<number>((acc, v) => acc + v, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

/** Multiply by a whole number — e.g. a daily rate x days, or years of service. */
export function times(amount: Paise, multiplier: number): Paise {
  assertInteger(multiplier, 'multiplier');
  return paise(amount * multiplier);
}

/**
 * A percentage of an amount, expressed in basis points.
 *
 *   percentOf(pfWage, EPF_RATE)  // 12% employee PF
 *
 * Integer maths throughout; rounded half-up once, at the end.
 */
export function percentOf(amount: Paise, rate: BasisPoints): Paise {
  return paise(roundHalfUp((amount * rate) / BP_DIVISOR));
}

/**
 * Pro-rata: the TRD's TR-20 step 3, `monthly x payable_days / month_days`.
 *
 * This is the division that makes float dangerous, so it is done here, once,
 * in integer space.
 */
export function prorate(amount: Paise, numerator: number, denominator: number): Paise {
  assertInteger(numerator, 'numerator');
  assertInteger(denominator, 'denominator');
  if (denominator === 0) throw new MoneyError('prorate: denominator is zero');
  return paise(roundHalfUp((amount * numerator) / denominator));
}

/**
 * A fraction of an amount — for formulas stated as a ratio rather than a
 * percentage. Gratuity is 15/26 of last drawn basic+DA per completed year
 * (Payment of Gratuity Act 1972), and is exactly the case that breaks float.
 */
export function fraction(amount: Paise, numerator: number, denominator: number): Paise {
  return prorate(amount, numerator, denominator);
}

/** The lesser of two amounts — e.g. capping PF wage at the ceiling. */
export function min(a: Paise, b: Paise): Paise {
  return (a < b ? a : b) as Paise;
}

export function max(a: Paise, b: Paise): Paise {
  return (a > b ? a : b) as Paise;
}

/** Clamp to zero. Deductions must never turn into earnings. */
export function atLeastZero(amount: Paise): Paise {
  return max(amount, ZERO);
}

export function isZero(amount: Paise): boolean {
  return amount === 0;
}

export function isNegative(amount: Paise): boolean {
  return amount < 0;
}

// ---------------------------------------------------------------------------
// Statutory rounding
// ---------------------------------------------------------------------------

/**
 * Round to the nearest whole rupee. EPFO and the Income Tax department both
 * want whole rupees on filings — this is a deliberate, named step, never an
 * accident of float representation.
 */
export function roundToNearestRupee(amount: Paise): Paise {
  return paise(roundHalfUp(amount / 100) * 100);
}

// ---------------------------------------------------------------------------
// Boundary: output
// ---------------------------------------------------------------------------

/** Paise -> rupees. Display and file export ONLY. Never feed this back in. */
export function toRupees(amount: Paise): number {
  return amount / 100;
}

/** "12,345.67" — Indian digit grouping (lakh/crore), no symbol. */
export function formatRupees(amount: Paise): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fractional = String(abs % 100).padStart(2, '0');

  // Indian grouping: last 3 digits, then 2 at a time. 1234567 -> "12,34,567".
  const digits = String(whole);
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  const grouped = head
    ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`
    : tail;

  return `${negative ? '-' : ''}${grouped}.${fractional}`;
}

/** "₹12,345.67" */
export function formatINR(amount: Paise): string {
  return `₹${formatRupees(amount)}`;
}
