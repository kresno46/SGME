import type { AiSettings } from '@smge/shared';
import type {
  AiAnswerDto,
  AiDraftDto,
  AiInteractionDto,
  AiLeadScoreDto,
  AiReplySuggestionDto,
  AiStatusDto,
  AiSummaryDto,
  AiUsageDto,
  KnowledgeDocumentDto,
  Paginated,
} from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => api.get<AiStatusDto>('/ai/status'),
    staleTime: 60_000,
  });
}

export function useKnowledge(params: {
  page: number;
  search?: string;
  category?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: ['ai', 'knowledge', params],
    queryFn: () =>
      api.get<Paginated<KnowledgeDocumentDto>>('/knowledge-documents', { ...params, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
}

export function useAiUsage(days: number, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'usage', days],
    queryFn: () => api.get<AiUsageDto>('/ai/usage', { days }),
    enabled,
  });
}

export function useAiInteractions(page: number, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'interactions', page],
    queryFn: () =>
      api.get<Paginated<AiInteractionDto & { simulated: boolean }>>('/ai/interactions', {
        page,
        pageSize: 15,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAiSettings(enabled = true) {
  return useQuery({
    queryKey: ['ai', 'settings'],
    queryFn: () => api.get<AiSettings>('/ai/settings'),
    enabled,
  });
}

/** Setiap pemanggilan AI memperbarui status (biaya bulan ini) & laporan penggunaan. */
function useAiMutation<V, R>(fn: (v: V) => Promise<R>, extra?: (r: R) => Promise<unknown> | void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await extra?.(r);
      await qc.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: () => undefined,
  });
}

export const useAsk = () =>
  useAiMutation((b: { question: string; leadId?: string | null }) =>
    api.post<AiAnswerDto>('/ai/ask', b),
  );

export const useReplySuggestion = () =>
  useAiMutation((b: { incomingMessage: string; leadId?: string | null; taskId?: string | null }) =>
    api.post<AiReplySuggestionDto>('/ai/reply-suggestion', b),
  );

export const useOutreachDraft = () =>
  useAiMutation((b: { taskId: string; instructions?: string | null }) =>
    api.post<AiDraftDto>('/ai/outreach-draft', b),
  );

export function useLeadScore(leadId: string) {
  const qc = useQueryClient();
  return useAiMutation(
    () => api.post<AiLeadScoreDto>(`/ai/leads/${leadId}/score`),
    () => qc.invalidateQueries({ queryKey: ['leads'] }),
  );
}

export function useLeadSummary(leadId: string) {
  const qc = useQueryClient();
  return useAiMutation(
    () => api.post<AiSummaryDto>(`/ai/leads/${leadId}/summary`),
    () => qc.invalidateQueries({ queryKey: ['leads', 'detail', leadId] }),
  );
}
