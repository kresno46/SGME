import type {
  WhatsappAdminSessionDto,
  WhatsappBroadcastDetailDto,
  WhatsappBroadcastDto,
  WhatsappChatDto,
  WhatsappChatListDto,
  WhatsappContactsDto,
  WhatsappConfigDto,
  WhatsappSendResultDto,
  WhatsappSessionDto,
  WhatsappThreadDto,
} from '@smge/types';
import type {
  WhatsappBroadcastInput,
  WhatsappNumberInput,
  WhatsappSendInput,
  WhatsappStartChatInput,
} from '@smge/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const KEY = ['whatsapp'] as const;

export function useWhatsappConfig() {
  return useQuery({
    queryKey: [...KEY, 'config'],
    queryFn: () => api.get<WhatsappConfigDto>('/whatsapp/config'),
    staleTime: 5 * 60_000,
  });
}

/** Semua nomor milik user, status langsung dari WAHA; lebih sering diperiksa saat ada yang menunggu QR. */
export function useSessions() {
  return useQuery({
    queryKey: [...KEY, 'sessions'],
    queryFn: () => api.get<WhatsappSessionDto[]>('/whatsapp/sessions'),
    refetchInterval: (q) =>
      q.state.data?.some(
        (s) => s.status === 'SCAN_QR_CODE' || s.status === 'STARTING' || s.historySyncing,
      )
        ? 3_000
        : 30_000,
  });
}

function useInvalidateSessions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

/** Menjalankan impor riwayat chat sekarang (di latar belakang); status tampil di kartu nomor. */
export function useSyncHistory() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ started: boolean }>(`/whatsapp/sessions/${id}/sync-history`),
    onSuccess: invalidate,
  });
}

export function useCreateSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (input: WhatsappNumberInput) =>
      api.post<WhatsappSessionDto>('/whatsapp/sessions', input),
    onSuccess: invalidate,
  });
}

export function useRenameSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (v: { id: string } & WhatsappNumberInput) =>
      api.patch<WhatsappSessionDto>(`/whatsapp/sessions/${v.id}`, { label: v.label }),
    onSuccess: invalidate,
  });
}

export function useRemoveSession() {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/whatsapp/sessions/${id}`),
    onSuccess: invalidate,
  });
}

export function useSessionAction(action: 'start' | 'stop' | 'logout' | 'reset') {
  const invalidate = useInvalidateSessions();
  return useMutation({
    mutationFn: (id: string) => api.post<WhatsappSessionDto>(`/whatsapp/sessions/${id}/${action}`),
    onSuccess: invalidate,
  });
}

export function useChats(params: {
  search?: string;
  unreadOnly?: boolean;
  sessionId?: string;
  page: number;
}) {
  return useQuery({
    queryKey: [...KEY, 'chats', params],
    queryFn: () =>
      api.get<WhatsappChatListDto>('/whatsapp/chats', {
        page: params.page,
        pageSize: 30,
        search: params.search,
        sessionId: params.sessionId,
        unreadOnly: params.unreadOnly || undefined,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
}

/** Kontak ponsel sebuah nomor (hanya bila sinkronisasi kontak aktif); dicari di server. */
export function useContacts(
  sessionId: string | null,
  search: string,
  enabled: boolean,
  savedOnly = false,
) {
  return useQuery({
    queryKey: [...KEY, 'contacts', sessionId, search, savedOnly],
    queryFn: () =>
      api.get<WhatsappContactsDto>(`/whatsapp/sessions/${sessionId}/contacts`, {
        search: search || undefined,
        savedOnly: savedOnly || undefined,
      }),
    enabled: enabled && !!sessionId,
    staleTime: 60_000,
    retry: false,
  });
}

/** Membuat ruang chat dengan satu nomor; pesan pertama tetap ditulis dan dikirim manusia. */
export function useStartChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sessionId: string } & WhatsappStartChatInput) =>
      api.post<WhatsappChatDto>(`/whatsapp/sessions/${v.sessionId}/chats`, {
        phone: v.phone,
        name: v.name,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'chats'] }),
  });
}

export function useThread(chatId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'thread', chatId],
    queryFn: () => api.get<WhatsappThreadDto>(`/whatsapp/chats/${chatId}`),
    enabled: !!chatId,
    refetchInterval: 5_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.post<{ ok: true }>(`/whatsapp/chats/${chatId}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'chats'] }),
    onError: () => undefined,
  });
}

export function useSend(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WhatsappSendInput) =>
      api.post<WhatsappSendResultDto>(`/whatsapp/chats/${chatId}/send`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...KEY, 'thread', chatId] });
      void qc.invalidateQueries({ queryKey: [...KEY, 'chats'] });
    },
  });
}

export function useAdminSessions(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'admin-sessions'],
    queryFn: () => api.get<WhatsappAdminSessionDto[]>('/whatsapp/admin/sessions'),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useAdminSessionAction(action: 'stop' | 'logout') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: true }>(`/whatsapp/admin/sessions/${sessionId}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'admin-sessions'] }),
  });
}

/** Daftar pengiriman terjadwal; lebih sering diperiksa selama ada yang berjalan. */
export function useBroadcasts(enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'broadcasts'],
    queryFn: () => api.get<WhatsappBroadcastDto[]>('/whatsapp/broadcasts'),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === 'RUNNING') ? 4_000 : 30_000),
  });
}

export function useBroadcastDetail(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'broadcast', id],
    queryFn: () => api.get<WhatsappBroadcastDetailDto>(`/whatsapp/broadcasts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'RUNNING' ? 4_000 : false),
  });
}

export function useCreateBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WhatsappBroadcastInput) =>
      api.post<WhatsappBroadcastDetailDto>('/whatsapp/broadcasts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, 'broadcasts'] }),
  });
}

export function useBroadcastAction(action: 'pause' | 'resume' | 'cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<WhatsappBroadcastDetailDto>(`/whatsapp/broadcasts/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
