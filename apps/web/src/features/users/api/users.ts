import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteUserInput, UpdateMemberRolesInput } from '@peoplepulse/core';
import { api } from '@/lib/api';

export interface RoleRef { id: string; name: string }
export interface RoleOption extends RoleRef { description: string | null }

export interface Member {
  userId: string;
  email: string;
  roles: RoleRef[];
  joinedAt: string;
  /** Has an authenticator set up. */
  mfaEnabled: boolean;
  /** Someone else, holding nothing you lack — so `user.manage` reaches them. The server re-checks. */
  manageable: boolean;
}

export interface PendingInvitation {
  id: string;
  email: string;
  roles: RoleRef[];
  invitedAt: string;
  expiresAt: string;
  expired: boolean;
}

export function useAccess() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ members: Member[]; invitations: PendingInvitation[] }>('/users'),
  });
}

/** Only roles the caller holds every permission of. The server decides, and re-checks on invite. */
export function useGrantableRoles() {
  return useQuery({
    queryKey: ['users', 'grantable-roles'],
    queryFn: () => api.get<RoleOption[]>('/users/grantable-roles'),
  });
}

/** Emails the invitee their link. The link never comes back here: only they should hold it. */
export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteUserInput) =>
      api.post<{ invitation: PendingInvitation }>('/users/invitations', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/users/invitations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** The whole set of roles they will hold. Needs `user.manage`, and so a verified second factor. */
export function useUpdateMemberRoles(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMemberRolesInput) => api.put<void>(`/users/${userId}/roles`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRemoveMember(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/users/${userId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetMemberMfa(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/users/${userId}/mfa`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

