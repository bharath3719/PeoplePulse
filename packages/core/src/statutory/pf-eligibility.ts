/**
 * Who actually gets PF and ESI. See ADR-004.
 *
 * THIS IS THE ONLY PLACE IN THE SYSTEM THAT ANSWERS THE QUESTION. It is never
 * inlined as a wage comparison, anywhere, for any reason.
 *
 * ----------------------------------------------------------------------------
 * THE TRAP
 * ----------------------------------------------------------------------------
 *
 * PF membership is a fact about the employee's HISTORY, not their current
 * salary. The naive implementation — "PF applies if PF wage <= 15,000" — is
 * wrong in both directions, silently, and looks perfectly correct in a spot
 * check:
 *
 *   - An existing MEMBER who gets a raise past Rs 15,000 STAYS a member.
 *     Once in the scheme, always in the scheme. The naive rule ejects them and
 *     stops deducting PF from someone who is legally still contributing.
 *
 *   - An EXCLUDED employee who gets a raise stays excluded. They were excluded
 *     at joining; nothing about a raise pulls them in. The naive rule would
 *     never enrol them anyway, but a "recompute each month" implementation WILL
 *     enrol them the moment a wage revision drops them below the ceiling.
 *
 * So eligibility is decided ONCE, at hire, and changed only by an explicit HR
 * action. It is NEVER recomputed from this month's payroll input.
 * ----------------------------------------------------------------------------
 */
import type { Paise } from '../money/paise';

/** EPF wage ceiling. Data, not code, in production (NFR-12) — this is the default. */
export const PF_WAGE_CEILING_PAISE = 1_500_000 as Paise; // Rs 15,000
export const ESI_GROSS_THRESHOLD_PAISE = 2_100_000 as Paise; // Rs 21,000

export type PfStatus = 'NOT_APPLICABLE' | 'EXCLUDED' | 'MEMBER';
export type EsiStatus = 'NOT_APPLICABLE' | 'NOT_COVERED' | 'COVERED';

export interface EstablishmentPfProfile {
  /**
   * Is the COMPANY registered for EPF?
   *
   * Mandatory at 20+ employees; voluntary below that (EPF Act s1(4)). Our
   * segment starts at 10 (BRD s2), so `false` is a common, CORRECT state — not
   * an unconfigured one.
   *
   * NEVER infer this from headcount. Crossing 20 employees does not register a
   * company, and a company that registered voluntarily at 8 is registered.
   */
  epfRegistered: boolean;
  esiRegistered: boolean;
}

export interface EmployeePfFacts {
  /** PF wage (Basic + DA) at the time of JOINING. Not the current wage. */
  pfWageAtJoining: Paise;
  /**
   * Was this person an EPF member before joining us?
   *
   * If yes, they are a MEMBER regardless of salary — prior membership binds.
   * An existing UAN is strong evidence, which is why onboarding must ASK
   * (CHR-04). HR will not volunteer it.
   */
  hasPriorPfMembership: boolean;
}

/**
 * Decide PF status AT HIRE.
 *
 * Call this once, when the employee is created or imported. Store the result.
 * Do not call it again from the payroll run.
 */
export function derivePfStatusAtHire(
  establishment: EstablishmentPfProfile,
  employee: EmployeePfFacts,
): PfStatus {
  // Gate 1: is the establishment even in the scheme?
  if (!establishment.epfRegistered) return 'NOT_APPLICABLE';

  // Gate 2: prior membership binds, at any salary. This clause is the one that
  // is most often missed, and it is the one that matters most — it is why a
  // senior hire on Rs 80,000 basic still gets PF.
  if (employee.hasPriorPfMembership) return 'MEMBER';

  // A first-time employee joining ABOVE the ceiling may be excluded
  // ("excluded employee", EPF Scheme Para 2(f)).
  if (employee.pfWageAtJoining > PF_WAGE_CEILING_PAISE) return 'EXCLUDED';

  return 'MEMBER';
}

/**
 * An EXCLUDED employee may opt in by agreement with the employer (Para 26(6)).
 *
 * So EXCLUDED is a DEFAULT, never a locked state. This exists so that opting in
 * is an explicit, auditable act rather than a field someone edits.
 */
export function optIntoPf(current: PfStatus): PfStatus {
  if (current === 'NOT_APPLICABLE') {
    throw new Error('Cannot opt into PF: the establishment is not EPF-registered');
  }
  return 'MEMBER';
}

/**
 * Does a raise change PF status? No. Never. This function exists to be the
 * explicit, greppable answer to a question people keep asking with code.
 */
export function pfStatusAfterSalaryChange(current: PfStatus): PfStatus {
  return current;
}

/**
 * ESI coverage, decided at the START of a contribution period (Apr-Sep,
 * Oct-Mar) and then HELD until that period ends — even if the wage crosses the
 * threshold mid-period (TRD TR-21).
 *
 * Like PF, this cannot be recomputed from the current month's wage. It is a
 * fact established at a point in time and carried forward.
 */
export function deriveEsiStatusAtPeriodStart(
  establishment: EstablishmentPfProfile,
  grossAtPeriodStart: Paise,
): EsiStatus {
  if (!establishment.esiRegistered) return 'NOT_APPLICABLE';
  return grossAtPeriodStart <= ESI_GROSS_THRESHOLD_PAISE ? 'COVERED' : 'NOT_COVERED';
}

/**
 * Should PF be computed for this employee in this payroll run?
 *
 * The payroll engine asks THIS, and never looks at a wage to decide. If it
 * returns false, the PF lines are ABSENT from the payslip — not zero. A
 * Rs 0.00 PF row at a company with no PF scheme is a support ticket.
 */
export function shouldComputePf(status: PfStatus): boolean {
  return status === 'MEMBER';
}

export function shouldComputeEsi(status: EsiStatus): boolean {
  return status === 'COVERED';
}
