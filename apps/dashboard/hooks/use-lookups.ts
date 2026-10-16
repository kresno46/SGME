import type { CampaignDto, Paginated, RefDto, TikTokAccountDto } from '@smge/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Data referensi untuk dropdown (di-cache 5 menit). */

export function useAccountOptions(lane?: 'OFFICIAL' | 'OUTBOUND') {
  return useQuery({
    queryKey: ['lookup', 'accounts', lane ?? 'all'],
    queryFn: () =>
      api.get<Paginated<TikTokAccountDto>>('/tiktok-accounts', {
        pageSize: 100,
        sortBy: 'username',
        sortDir: 'asc',
        lane,
      }),
    select: (d) => d.items,
    staleTime: 300_000,
  });
}

export function useCampaignOptions(lane?: 'OFFICIAL' | 'OUTBOUND') {
  return useQuery({
    queryKey: ['lookup', 'campaigns', lane ?? 'all'],
    queryFn: () => api.get<Paginated<CampaignDto>>('/campaigns', { pageSize: 100, lane, sortBy: 'name', sortDir: 'asc' }),
    select: (d) => d.items,
    staleTime: 300_000,
  });
}

export function useAssignableUsers() {
  return useQuery({
    queryKey: ['lookup', 'assignable-users'],
    queryFn: () => api.get<RefDto[]>('/users/assignable'),
    staleTime: 300_000,
  });
}
