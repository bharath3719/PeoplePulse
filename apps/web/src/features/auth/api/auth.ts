import { useMutation, useQuery } from '@tanstack/react-query';
import { api, tokenStore } from '@/lib/api';
import type { Session } from '../permissions';

export interface TenantOption { id: string; name: string; slug: string }

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
  return useMutation({
    mutationFn: (tenantId: string) => api.post<LoginResult>('/auth/switch-tenant', { tenantId }),
    onSuccess: (result) => {
      tokenStore.set(result.accessToken);
      window.location.reload(); // everything on screen belongs to the old company
    },
  });
}
