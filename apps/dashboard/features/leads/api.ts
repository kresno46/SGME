import type { DncEntryDto, LeadDetailDto, LeadDto, Paginated } from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type LeadFilters = Record<string, string | number | boolean | undefined>;

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => api.get<Paginated<LeadDto>>('/leads', filters),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', 'detail', id],
    queryFn: () => api.get<LeadDetailDto>(`/leads/${id}`),
  });
}

export function useInvalidateLeads() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['leads'] }),
      qc.invalidateQueries({ queryKey: ['dnc'] }),
      qc.invalidateQueries({ queryKey: ['outbound'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
}

/** Mutasi pada satu prospek yang mengembalikan detail terbaru. */
export function useLeadMutation<V>(fn: (v: V) => Promise<LeadDetailDto>) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (lead) => {
      qc.setQueryData(['leads', 'detail', lead.id], lead);
      await invalidate();
    },
  });
}

export function useDnc(filters: { page: number; search?: string; channel?: string }) {
  return useQuery({
    queryKey: ['dnc', filters],
    queryFn: () => api.get<Paginated<DncEntryDto>>('/do-not-contact', { ...filters, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
}
