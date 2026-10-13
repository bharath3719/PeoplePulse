import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/lib/api';
import type { Session, TenantOption } from '../permissions';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  activeTenant: TenantOption;
  tenants: TenantOption[];
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface RecoveryCodes {
  /** Shown once: the server keeps only their hashes. */
  recoveryCodes: string[];
}

export interface MfaEnrolment {
  secret: string;
  otpauthUri: string;
  /** A data: URL — rendered, never fetched. */
  qrCode: string;
}

/**
 * Every MFA step ends the same way: a new token that carries the verified second
 * factor replaces the old one, and the session is re-read so everything gated
 * on `mfaVerified` sees it.
 *
 * Confirming enrolment holds the re-read back (`refreshSession: false`) until
 * the recovery codes it returned have been saved — see MfaEnrolment.
 */
function useMfaTokenSwap<TInput, TResult extends Tokens>(
  mutationFn: (input: TInput) => Promise<TResult>,
  { refreshSession = true } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result) => {
      tokenStore.set(result.accessToken);
      if (refreshSession) await qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

/** Re-read the session, for the step that deferred it. */
export function useRefreshSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['session'] });
}

/** A code from the authenticator app, for an MFA-verified token. */
export function useVerifyMfa() {
  return useMfaTokenSwap((code: string) => api.post<Tokens>('/auth/mfa/verify', { code }));
}

/** A recovery code instead, when the phone is gone. Each works once. */
export function useRecoverMfa() {
  return useMfaTokenSwap((recoveryCode: string) =>
    api.post<Tokens & { recoveryCodesLeft: number }>('/auth/mfa/recover', { recoveryCode }));
}

/** A new set of recovery codes, replacing the old. Needs a verified session. */
export function useRegenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RecoveryCodes>('/auth/mfa/recovery-codes'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session'] }),
  });
}

/** Mint a secret to scan — a first authenticator, or a replacement. Each call replaces the last unconfirmed one. */
export function useStartMfaEnrolment() {
  return useMutation({
    mutationFn: () => api.post<MfaEnrolment>('/auth/mfa/enrol'),
  });
}

/** The first code from the newly-scanned app switches it on, and returns recovery codes to save. */
export function useConfirmMfaEnrolment() {
  return useMfaTokenSwap(
    (code: string) => api.post<Tokens & RecoveryCodes>('/auth/mfa/enrol/confirm', { code }),
    { refreshSession: false },
  );
}

export function useLogin() {
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<LoginResult>('/auth/login', input),
    onSuccess: (result) => tokenStore.set(result.accessToken),
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: (input: {
      companyName: string; adminFirstName: string; adminEmail: string; adminPassword: string;
    }) => api.post<LoginResult>('/auth/signup', input),
    onSuccess: (result) => tokenStore.set(result.accessToken),
  });
}

/**
 * The session. Everything the UI knows about who you are and what you may do.
 *
 * Fetched from the server rather than decoded from the JWT: permissions are
 * resolved server-side on every request (see JwtPayload), so this is the only
 * account of them that cannot go stale.
 */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<Session>('/auth/me'),
    enabled: Boolean(tokenStore.get()),
    retry: false,
    staleTime: 60_000,
  });
}

/** Switch company (D-16) — for a CA firm's accountant serving several clients. */
export function useSwitchTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => api.post<LoginResult>('/auth/switch-tenant', { tenantId }),
    onSuccess: (result) => {
      tokenStore.set(result.accessToken);
      // A hard navigation to the root, not a reload. Everything cached belongs to
      // the old company, and the current URL may name one of its records
      // (/employees/:id), which the new company would answer with a 404.
      window.location.assign('/');
    },
    // Refused: access was revoked since the list was fetched. Refetch it so the
    // company that refused drops out of the switcher.
    onError: () => void qc.invalidateQueries({ queryKey: ['session'] }),
  });
}

export interface InvitationPreview {
  email: string;
  companyName: string;
  roles: string[];
  hasAccount: boolean;
  expiresAt: string;
}

/** What an invitation link is for. POSTed, so the token never sits in a URL the server logs. */
export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.post<InvitationPreview>('/auth/invitations/preview', { token }),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api.post<LoginResult>('/auth/invitations/accept', input),
    onSuccess: (result) => tokenStore.set(result.accessToken),
  });
}
