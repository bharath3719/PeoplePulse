import type { Session } from '@/features/auth/permissions';

/**
 * What to call the person signed in. Their employee record's name where there
 * is one here; otherwise a name made from their address ("anjali.hegde@…" →
 * "Anjali Hegde"), which is a guess, so it is only ever used to greet and label,
 * never to identify.
 */
export function displayName(session: Pick<Session, 'name' | 'email'>): string {
  if (session.name) return session.name;
  const local = session.email.split('@')[0] ?? '';
  const words = local.split(/[._\-+]+/).filter((w) => w && !/^\d+$/.test(w));
  if (words.length === 0) return session.email || 'there';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function firstName(session: Pick<Session, 'name' | 'email'>): string {
  return displayName(session).split(' ')[0] ?? '';
}
