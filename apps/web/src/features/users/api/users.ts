import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteUserInput } from '@peoplepulse/core';
import { api } from '@/lib/api';

export interface RoleRef { id: string; name: string }
export interface RoleOption extends RoleRef { description: string | null }

export interface Member {
  userId: string;
  email: string;
  roles: RoleRef[];
  joinedAt: string;
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

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteUserInput) =>
      api.post<{ invitation: PendingInvitation; token: string }>('/users/invitations', input),
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

/**
 * The link the inviter sends on. The token rides in the fragment, which the
 * browser never sends to a server and never puts in a Referer header — so it
 * stays out of access logs and out of whatever page the invitee visits next.
 */
export function invitationLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}
