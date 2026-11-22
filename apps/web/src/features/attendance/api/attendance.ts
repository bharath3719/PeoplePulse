import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignRosterInput, CreateShiftInput, PunchDirection, PunchInput, UpdateShiftInput,
} from '@peoplepulse/core';
import { api } from '@/lib/api';

/**
 * Times of day arrive as "HH:MM" in IST; punches as ISO instants, shown in IST
 * (format.ts). Which day a punch belongs to is the server's answer — the page
 * never works it out, so it cannot disagree with what day derivation will read.
 */

export interface ShiftRef {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface Shift extends ShiftRef {
  graceMinutes: number;
  crossesMidnight: boolean;
  lengthMinutes: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface RosterEntry {
  id: string;
  effectiveFrom: string;
  shift: ShiftRef;
  weeklyOffDays: number[];
}

export interface Roster {
  employeeId: string;
  today: string;
  current: { shift: ShiftRef | null; weeklyOffDays: number[]; from: 'ROSTER' | 'COMPANY' };
  entries: RosterEntry[];
  /** The server's answer. It checks again when you act on it. */
  canManage: boolean;
}

export interface Punch {
  id: string;
  at: string;
  direction: PunchDirection | null;
  source: 'WEB' | 'MOBILE' | 'BIOMETRIC' | 'IMPORT';
}

export interface AttendanceDay {
  date: string;
  shift: ShiftRef | null;
  weeklyOff: boolean;
  holiday: string | null;
  punches: Punch[];
}

export interface PunchStatus {
  today: AttendanceDay;
  next: PunchDirection;
}

// --- Shifts ------------------------------------------------------------------

export function useShifts() {
  return useQuery({ queryKey: ['attendance', 'shifts'], queryFn: () => api.get<Shift[]>('/attendance/shifts') });
}

/**
 * A shift, a roster or a punch can each change what another card shows — a
 * shift's new hours, someone's weekly off — so every change refreshes
 * everything under 'attendance' rather than guessing which part. Leave too: a
 * roster's weekly offs are the days leave does not count.
 */
function useAttendanceMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, alsoLeave = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      if (alsoLeave) void qc.invalidateQueries({ queryKey: ['leave'] });
    },
  });
}

export const useCreateShift = () =>
  useAttendanceMutation((input: CreateShiftInput) => api.post<Shift>('/attendance/shifts', input));

export const useUpdateShift = (id: string) =>
  useAttendanceMutation((input: UpdateShiftInput) => api.patch<Shift>(`/attendance/shifts/${id}`, input));

export const useMakeDefaultShift = () =>
  useAttendanceMutation((id: string) => api.post<Shift>(`/attendance/shifts/${id}/default`));

// --- Rosters -----------------------------------------------------------------

export function useRoster(employeeId: string) {
  return useQuery({
    queryKey: ['attendance', 'roster', employeeId],
    queryFn: () => api.get<Roster>(`/attendance/employees/${employeeId}/roster`),
    retry: false,
  });
}

export const useAssignRoster = () =>
  useAttendanceMutation((input: AssignRosterInput) => api.post<RosterEntry>('/attendance/roster', input), true);

export const useRemoveRosterEntry = () =>
  useAttendanceMutation((id: string) => api.delete<void>(`/attendance/roster/${id}`), true);

// --- Punches -----------------------------------------------------------------

export function usePunchStatus(enabled = true) {
  return useQuery({
    queryKey: ['attendance', 'me'],
    queryFn: () => api.get<PunchStatus>('/attendance/me'),
    enabled,
    // The button must not offer "Punch in" to someone who punched in from
    // another tab an hour ago.
    refetchOnWindowFocus: true,
  });
}

/**
 * Refreshes on failure too: a refusal ("already punched in") means the card was
 * stale — another tab, another device — and the fresh status flips the button.
 */
export function usePunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PunchInput) => api.post<PunchStatus>('/attendance/punches', input),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['attendance'] }),
  });
}

export function useAttendanceDays(employeeId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['attendance', 'days', employeeId, from, to],
    queryFn: () => api.get<AttendanceDay[]>(`/attendance/employees/${employeeId}/days?from=${from}&to=${to}`),
    retry: false,
  });
}
