import { can, type Actor, type Permission } from '@peoplepulse/core';

/**
 * Field-level sensitivity (ADM-01).
 *
 * Salary, PAN, and bank details must be invisible to users who lack the
 * permission — and that is NOT the handler's job. If it were, every endpoint
 * that returns an employee would have to remember, and one day one of them
 * won't. It would be the fourth endpoint, added in a hurry, by someone who
 * didn't know.
 *
 * So redaction happens ONCE, here, at the serialization boundary. An endpoint
 * author cannot forget it, because they were never asked to remember it.
 *
 * The field is REMOVED, not nulled. A `salary: null` in a JSON response tells a
 * caller the field exists and they are not allowed to see it; over enough
 * endpoints that leaks structure. Absent is absent.
 */

/** Declares which permission each sensitive field requires. */
export type FieldPolicy<T> = {
  readonly [K in keyof T]?: Permission;
};

export function redact<T extends Record<string, unknown>>(
  actor: Actor,
  value: T,
  policy: FieldPolicy<T>,
): Partial<T> {
  const out: Partial<T> = {};

  for (const [key, fieldValue] of Object.entries(value) as [keyof T, T[keyof T]][]) {
    const required = policy[key];
    if (required && !can(actor, required)) continue; // omit entirely
    out[key] = fieldValue;
  }

  return out;
}

export function redactMany<T extends Record<string, unknown>>(
  actor: Actor,
  values: readonly T[],
  policy: FieldPolicy<T>,
): Partial<T>[] {
  return values.map((v) => redact(actor, v, policy));
}

/**
 * Mask a value for display to someone who may see THAT it exists but not what
 * it is. "ABCDE1234F" -> "XXXXXX234F".
 *
 * Note we store `panLast4` alongside the ciphertext precisely so the common
 * case — showing a masked PAN in a list — never decrypts anything at all. A
 * decryption is an audited event (TR-52); a list view should not generate 200
 * of them.
 */
export function maskTail(last4: string | null, length = 10): string | null {
  if (!last4) return null;
  return 'X'.repeat(Math.max(0, length - last4.length)) + last4;
}
