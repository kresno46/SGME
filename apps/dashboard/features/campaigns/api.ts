import type { CreateCampaignInput } from '@smge/shared';
import type { CampaignDto, Paginated } from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface CampaignFilters {
  page: number;
  pageSize: number;
  search?: string;
  lane?: string;
  status?: string;
  type?: string;
}

export function useCampaigns(filters: CampaignFilters) {
  return useQuery({
    queryKey: ['campaigns', filters],
    queryFn: () => api.get<Paginated<CampaignDto>>('/campaigns', { ...filters }),
    placeholderData: keepPreviousData,
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaigns', 'detail', id],
    queryFn: () => api.get<CampaignDto>(`/campaigns/${id}`),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['campaigns'] }),
      qc.invalidateQueries({ queryKey: ['lookup', 'campaigns'] }),
    ]);
}

export function useSaveCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: Partial<CreateCampaignInput> }) =>
      id
        ? api.patch<CampaignDto>(`/campaigns/${id}`, data)
        : api.post<CampaignDto>('/campaigns', data),
    onSuccess: invalidate,
    onError: () => undefined,
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: invalidate,
  });
}
