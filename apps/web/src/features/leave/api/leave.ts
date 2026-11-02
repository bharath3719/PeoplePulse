import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  previewLeaveSchema,
  type ApplyLeaveInput, type CreateHolidayInput, type CreateLeaveTypeInput, type LeaveAdjustmentInput,
  type LeaveDecisionInput, type LeaveSettingsInput, type PostAccrualsInput, type PreviewLeaveInput,
  type Session, type UpdateLeaveTypeInput,
} from '@peoplepulse/core';
import { api } from '@/lib/api';

/**
 * Quantities arrive in DAYS (the API converts at its edge, as it does rupees).
 * Display them; never add them up here — a total is the server's to compute.
 */

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  dayCountBasis: 'WORKING_DAYS' | 'CALENDAR_DAYS';
  allowsHalfDay: boolean;
  accrualFrequency: 'NONE' | 'MONTHLY' | 'YEARLY';
  annualEntitlementDays: number;
  proRataOnJoin: boolean;
  isActive: boolean;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employee: { id: string; empCode: string; name: string };
  leaveType: { id: string; code: string; name: string };
  startDate: string;
  startSession: Session;
  endDate: string;
  endSession: Session;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The server's answer. It checks again when you act on it. */
  canDecide: boolean;
  canCancel: boolean;
}

export interface LeavePreview {
  days: number;
  isPaid: boolean;
  balanceDays: number | null;
  pendingDays: number | null;
  availableAfterDays: number | null;
}

export interface LeaveBalance {
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
  calendarYear: number;
  balanceDays: number | null;
  pendingDays: number;
  availableDays: number | null;
  takenDays: number;
}

export interface LedgerEntry {
  id: string;
  leaveType: { id: string; code: string; name: string };
  kind: 'OPENING' | 'GRANT' | 'ACCRUAL' | 'ADJUSTMENT' | 'DEBIT' | 'REVERSAL';
  days: number;
  accrualPeriod: string | null;
  reason: string | null;
  request: { id: string; startDate: string; endDate: string } | null;
  createdAt: string;
}

// --- Policy ----------------------------------------------------------------

export function useLeaveTypes() {
  return useQuery({ queryKey: ['leave', 'types'], queryFn: () => api.get<LeaveType[]>('/leave/types') });
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: ['leave', 'holidays', year],
    queryFn: () => api.get<Holiday[]>(`/leave/holidays?year=${year}`),
  });
}

export function useLeaveSettings() {
  return useQuery({
    queryKey: ['leave', 'settings'],
    queryFn: () => api.get<{ weeklyOffDays: number[] }>('/leave/settings'),
  });
}

/**
 * Every leave change can move a balance or a preview somewhere else on screen —
 * a holiday re-prices the form, an approval moves the employee's card — so each
 * one refreshes everything under 'leave' rather than guessing which part.
 */
function useLeaveMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['leave'] }) });
}

export const useCreateLeaveType = () =>
  useLeaveMutation((input: CreateLeaveTypeInput) => api.post<LeaveType>('/leave/types', input));

export const useUpdateLeaveType = (id: string) =>
  useLeaveMutation((input: UpdateLeaveTypeInput) => api.patch<LeaveType>(`/leave/types/${id}`, input));

export const useAddDefaultLeaveTypes = () =>
  useLeaveMutation((_: void) => api.post<LeaveType[]>('/leave/types/defaults'));

export const useCreateHoliday = () =>
  useLeaveMutation((input: CreateHolidayInput) => api.post<Holiday>('/leave/holidays', input));

export const useDeleteHoliday = () =>
  useLeaveMutation((id: string) => api.delete<void>(`/leave/holidays/${id}`));

export const useUpdateLeaveSettings = () =>
  useLeaveMutation((input: LeaveSettingsInput) => api.put<{ weeklyOffDays: number[] }>('/leave/settings', input));

export const usePostAccruals = () =>
  useLeaveMutation((input: PostAccrualsInput) =>
    api.post<{ through: string; posted: number; alreadyPosted: number }>('/leave/accruals', input));

// --- Requests --------------------------------------------------------------

export function useLeaveRequests(filter: { status?: LeaveStatus; year?: number } = {}) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.year) params.set('year', String(filter.year));
  const query = params.toString();
  return useQuery({
    queryKey: ['leave', 'requests', filter],
    queryFn: () => api.get<LeaveRequest[]>(`/leave/requests${query ? `?${query}` : ''}`),
  });
}

/**
 * What the request in the form would cost. Asked only once the form parses —
 * the same schema the server uses — and the server checks it exactly as it
 * will check the application: balance, overlaps, holidays, joining date.
 */
export function useLeavePreview(input: PreviewLeaveInput | null) {
  const ready = input !== null && previewLeaveSchema.safeParse(input).success;
  return useQuery({
    queryKey: ['leave', 'preview', input],
    queryFn: () => api.post<LeavePreview>('/leave/requests/preview', input),
    enabled: ready,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export const useApplyLeave = () =>
  useLeaveMutation((input: ApplyLeaveInput) => api.post<LeaveRequest>('/leave/requests', input));

export const useDecideLeave = () =>
  useLeaveMutation(({ id, ...decision }: { id: string } & LeaveDecisionInput) =>
    api.post<LeaveRequest>(`/leave/requests/${id}/decision`, decision));

export const useCancelLeave = () =>
  useLeaveMutation((id: string) => api.post<LeaveRequest>(`/leave/requests/${id}/cancel`));

// --- Balances --------------------------------------------------------------

export function useLeaveBalances(employeeId: string | null, year: number) {
  return useQuery({
    queryKey: ['leave', 'balances', employeeId, year],
    queryFn: () => api.get<LeaveBalance[]>(`/leave/employees/${employeeId}/balances?year=${year}`),
    enabled: Boolean(employeeId),
    retry: false,
  });
}

export function useLeaveLedger(employeeId: string, year: number, enabled: boolean) {
  return useQuery({
    queryKey: ['leave', 'ledger', employeeId, year],
    queryFn: () => api.get<LedgerEntry[]>(`/leave/employees/${employeeId}/ledger?year=${year}`),
    enabled,
  });
}

export const useAdjustLeave = () =>
  useLeaveMutation((input: LeaveAdjustmentInput) => api.post<LedgerEntry>('/leave/adjustments', input));
