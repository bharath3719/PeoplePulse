import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface OrgUnit { id: string; name: string }
export interface Location extends OrgUnit { state: string; city: string | null }

export interface Org {
  locations: Location[];
  departments: OrgUnit[];
  designations: OrgUnit[];
  grades: OrgUnit[];
}

export function useOrg() {
  return useQuery({ queryKey: ['org'], queryFn: () => api.get<Org>('/org') });
}

function useCreateOrgUnit<T>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => api.post(`/org/${path}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['org'] }),
  });
}

export const useCreateLocation = () =>
  useCreateOrgUnit<{ name: string; state: string; city?: string }>('locations');
export const useCreateDepartment = () => useCreateOrgUnit<{ name: string }>('departments');
export const useCreateDesignation = () => useCreateOrgUnit<{ name: string }>('designations');
