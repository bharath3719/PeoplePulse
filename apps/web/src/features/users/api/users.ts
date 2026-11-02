import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteUserInput, LinkEmployeeInput, UpdateMemberRolesInput } from '@peoplepulse/core';
import { api } from '@/lib/api';

export interface RoleRef { id: string; name: string }

/** An employee record, as the access screens name it. */
export interface EmployeeRef { id: string; empCode: string; name: string }

/** Each employee the admin can see, and who signs in as them (D-26). */
export interface EmployeeLogin extends EmployeeRef {
  workEmail: string | null;
  login: string | null;
  invitedAs: string | null;
}
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
  /** The employee they sign in as. Their "own" leave and payslips are this person's. */
  employee: EmployeeRef | null;
}

export interface PendingInvitation {
  id: string;
  email: string;
  roles: RoleRef[];
  invitedAt: string;
  expiresAt: string;
  expired: boolean;
  /** Who accepting links them to. */
  employee: EmployeeRef | null;
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

/** For the invite and link pickers. Scoped server-side to employees the caller can see. */
export function useEmployeeLogins(enabled = true) {
  return useQuery({
    queryKey: ['users', 'employee-logins'],
    queryFn: () => api.get<EmployeeLogin[]>('/users/employee-logins'),
    enabled,
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

/** Which employee they sign in as, or none. Needs `user.manage`, and so a verified second factor. */
export function useLinkEmployee(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkEmployeeInput) => api.put<void>(`/users/${userId}/employee`, input),
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

