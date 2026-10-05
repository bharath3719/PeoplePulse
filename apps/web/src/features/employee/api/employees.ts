import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Sensitive fields are OPTIONAL in this type — and that is not laziness.
 *
 * The server REMOVES fields the caller may not see (it does not null them), so
 * `panMasked` is genuinely absent for a user without `employee.identifiers.view`.
 * Typing them as optional forces every consumer to handle the absence, which is
 * exactly the outcome we want: a component cannot accidentally render `undefined`
 * where a salary should be.
 */
export interface Employee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  phone: string | null;
  joinDate: string;
  status: string;
  employmentType: string;
  locationId: string | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  managerId: string | null;
  pfStatus: string;
  hasPriorPfMembership: boolean;
  esiStatus: string;

  dateOfBirth?: string | null;
  gender?: string | null;
  personalEmail?: string | null;
  panMasked?: string | null;
  uan?: string | null;
  esicNumber?: string | null;
  bankAccountMasked?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  pfJoiningWageRupees?: number | null;
}

export function useEmployees(search?: string) {
  return useQuery({
    queryKey: ['employees', search ?? ''],
    queryFn: () =>
      api.get<{ data: Employee[] }>(`/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    select: (r) => r.data,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get<Employee>(`/employees/${id}`),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => api.post<Employee>('/employees', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

/**
 * Correct an employee. The body is a PATCH: absent = unchanged, null = cleared.
 *
 * The response is the server's view of the corrected record — including a PF
 * status it may have re-derived — so it replaces the cached profile outright.
 */
export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Employee>(`/employees/${id}`, patch),
    onSuccess: (employee) => {
      qc.setQueryData(['employee', id], employee);
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

/** Decrypting PAN / bank details is a separate, audited call (TR-52). */
export function useRevealIdentifiers(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['employee', id, 'identifiers'],
    queryFn: () => api.get<{ pan: string | null; bankAccount: string | null }>(`/employees/${id}/identifiers`),
    enabled,
    staleTime: 0,
    gcTime: 0, // never cache decrypted PII in memory longer than needed
  });
}
