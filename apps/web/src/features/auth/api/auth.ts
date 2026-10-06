import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '@/lib/api';
import type { Session, TenantOption } from '../permissions';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  mfaRequired: boolean;
  activeTenant: TenantOption;
  tenants: TenantOption[];
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
