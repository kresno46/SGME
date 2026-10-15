import type { CreateTikTokAccountInput, UpdateTikTokAccountInput } from '@smge/shared';
import type { Paginated, TikTokAccountDto } from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface AccountFilters {
  page: number;
  pageSize: number;
  search?: string;
  lane?: string;
  status?: string;
}

export function useAccounts(filters: AccountFilters) {
  return useQuery({
    queryKey: ['tiktok-accounts', filters],
    queryFn: () => api.get<Paginated<TikTokAccountDto>>('/tiktok-accounts', { ...filters }),
    placeholderData: keepPreviousData,
  });
}

export function useAccount(id: string) {
  return useQuery({
    queryKey: ['tiktok-accounts', 'detail', id],
    queryFn: () => api.get<TikTokAccountDto>(`/tiktok-accounts/${id}`),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
}

export function useSaveAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id?: string;
      data: CreateTikTokAccountInput | UpdateTikTokAccountInput;
    }) =>
      id
        ? api.patch<TikTokAccountDto>(`/tiktok-accounts/${id}`, data)
        : api.post<TikTokAccountDto>('/tiktok-accounts', data),
    onSuccess: invalidate,
    onError: () => undefined, // ditangani form
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/tiktok-accounts/${id}`),
    onSuccess: invalidate,
  });
}
