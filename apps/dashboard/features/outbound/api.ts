import type { TaskActionInput } from '@smge/shared';
import type {
  MessageTemplateDto,
  OutboundQueueItemDto,
  OutboundSummaryDto,
  OutreachTaskDto,
  Paginated,
} from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useOutboundSummary(accountId: string | null) {
  return useQuery({
    queryKey: ['outbound', 'summary', accountId],
    queryFn: () => api.get<OutboundSummaryDto>(`/outbound/summary/${accountId}`),
    enabled: !!accountId,
  });
}

export function useQueue(params: {
  accountId: string | null;
  page: number;
  search?: string;
  channel?: string;
}) {
  return useQuery({
    queryKey: ['outbound', 'queue', params],
    queryFn: () =>
      api.get<Paginated<OutboundQueueItemDto> & { truncated: boolean }>('/outbound/queue', {
        ...params,
        pageSize: 20,
      }),
    enabled: !!params.accountId,
    placeholderData: keepPreviousData,
  });
}

export function useTasks(params: Record<string, string | number | boolean | undefined>) {
  return useQuery({
    queryKey: ['outbound', 'tasks', params],
    queryFn: () =>
      api.get<Paginated<OutreachTaskDto>>('/outbound/tasks', { ...params, pageSize: 20 }),
    enabled: !!params.accountId,
    placeholderData: keepPreviousData,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ['outbound', 'task', id],
    queryFn: () => api.get<OutreachTaskDto>(`/outbound/tasks/${id}`),
    enabled: !!id,
  });
}

export function useTemplates(activeOnly = false) {
  return useQuery({
    queryKey: ['outbound', 'templates', activeOnly],
    queryFn: () => api.get<MessageTemplateDto[]>('/message-templates', { activeOnly }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['outbound'] }),
      qc.invalidateQueries({ queryKey: ['leads'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
}

export function useCreateTask() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<OutreachTaskDto>('/outbound/tasks', body),
    onSuccess: invalidate,
    onError: () => undefined,
  });
}

export function useTaskAction(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: TaskActionInput) =>
      api.post<OutreachTaskDto>(`/outbound/tasks/${id}/actions`, body),
    onSuccess: async (task) => {
      qc.setQueryData(['outbound', 'task', id], task);
      await invalidate();
    },
    onError: () => undefined,
  });
}

export function useUpdateDraft(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: string | { draftMessage: string; aiGenerated?: boolean }) =>
      api.patch<OutreachTaskDto>(
        `/outbound/tasks/${id}/draft`,
        typeof v === 'string' ? { draftMessage: v } : v,
      ),
    onSuccess: (task) => qc.setQueryData(['outbound', 'task', id], task),
  });
}

export function useInvalidateOutbound() {
  return useInvalidate();
}
