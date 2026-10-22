import type {
  IntegrationLogDto,
  IntegrationsOverviewDto,
  Paginated,
  SyncResultDto,
} from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isVisibleLane } from '@/lib/marketing-scope';

export function useIntegrationsOverview() {
  return useQuery({
    queryKey: ['integrations', 'overview'],
    queryFn: () => api.get<IntegrationsOverviewDto>('/integrations/overview'),
    select: (data) => ({
      ...data,
      accounts: data.accounts.filter((a) => isVisibleLane(a.account.lane)),
    }),
  });
}

export function useIntegrationLogs(page: number, onlyErrors: boolean) {
  return useQuery({
    queryKey: ['integrations', 'logs', page, onlyErrors],
    queryFn: () =>
      api.get<Paginated<IntegrationLogDto>>('/integrations/logs', {
        page,
        pageSize: 15,
        onlyErrors: onlyErrors || undefined,
      }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['integrations'] }),
      qc.invalidateQueries({ queryKey: ['tiktok-accounts'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
}

/** Memulai OAuth: browser diarahkan ke halaman otorisasi TikTok (atau halaman simulasi). */
export function useConnect() {
  return useMutation({
    mutationFn: (v: { accountId: string; provider: 'TIKTOK_LOGIN_KIT' | 'MOCK' }) =>
      api.post<{ authorizeUrl: string }>(`/integrations/tiktok/accounts/${v.accountId}/connect`, {
        provider: v.provider,
      }),
    onSuccess: ({ authorizeUrl }) => {
      window.location.href = authorizeUrl;
    },
  });
}

export function useSync() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (integrationId: string) =>
      api.post<SyncResultDto>(`/integrations/${integrationId}/sync`),
    onSuccess: invalidate,
  });
}

export function useDisconnect() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (integrationId: string) => api.post(`/integrations/${integrationId}/disconnect`),
    onSuccess: invalidate,
  });
}
