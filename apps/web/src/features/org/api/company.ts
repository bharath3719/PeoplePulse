import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CompanySettings {
  id: string;
  name: string;
  slug: string;
  epfRegistered: boolean;
  epfEstablishmentCode: string | null;
  epfRegisteredFrom: string | null;
  esiRegistered: boolean;
  esiEstablishmentCode: string | null;
  pfRestrictToCeiling: boolean;
}

export function useCompanySettings() {
  return useQuery({
    queryKey: ['company', 'settings'],
    queryFn: () => api.get<CompanySettings>('/company/settings'),
  });
}

/**
 * Turning EPF/ESI on decides whether PF is computed AT ALL, for anybody.
 *
 * It does NOT retroactively enrol the people already on the books — pfStatus is
 * decided at hire and stored. Silently flipping 12 existing employees to MEMBER
 * would start deducting PF from people who have not been told.
 */
export function useUpdateStatutory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CompanySettings>) => api.patch('/company/statutory', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company'] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}
