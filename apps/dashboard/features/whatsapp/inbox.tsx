'use client';

import { WHATSAPP_MAX_MESSAGE_LENGTH, WHATSAPP_MESSAGE_STATUS_LABELS } from '@smge/shared';
import type { WhatsappChatDto, WhatsappMessageDto } from '@smge/types';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  Search,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Card, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { useDebounce } from '@/hooks/use-debounce';
import { cn, formatDateTime, formatRelative } from '@/lib/utils';
import { useChats, useMarkRead, useSend, useSessions, useThread } from './api';
import { NewChatDialog } from './new-chat-dialog';

const chatTitle = (c: Pick<WhatsappChatDto, 'contactName' | 'contactPhone'>) =>
  c.contactName || (c.contactPhone ? `+${c.contactPhone}` : 'Kontak tanpa nama');

function Ticks({ status }: { status: WhatsappMessageDto['status'] }) {
  const label = WHATSAPP_MESSAGE_STATUS_LABELS[status];
  const cls = 'size-3.5 shrink-0';
  if (status === 'SENDING') return <Clock className={cls} aria-label={label} />;
  if (status === 'FAILED')
    return <AlertCircle className={cn(cls, 'text-destructive')} aria-label={label} />;
  if (status === 'SENT') return <Check className={cls} aria-label={label} />;
  if (status === 'DELIVERED') return <CheckCheck className={cls} aria-label={label} />;
  if (status === 'READ')
    return <CheckCheck className={cn(cls, 'text-brand-text')} aria-label={label} />;
  return null;
}

function Bubble({ m }: { m: WhatsappMessageDto }) {
  const out = m.direction === 'OUTBOUND';
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs sm:max-w-[70%]',
          out
            ? 'rounded-br-sm border border-primary/30 bg-primary/15'
            : 'rounded-bl-sm border bg-card',
        )}
      >
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <span title={formatDateTime(m.sentAt)}>
            {new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(
              new Date(m.sentAt),
            )}
          </span>
          {out && <Ticks status={m.status} />}
        </p>
        {m.status === 'FAILED' && (
          <p className="mt-1 text-xs text-destructive">
            {m.failureReason === 'timeout' || m.failureReason === 'stuck'
              ? 'Status tidak pasti; periksa ponsel sebelum mengirim ulang.'
              : `Gagal terkirim${m.failureReason ? ` (${m.failureReason})` : ''}. Kirim ulang dari kotak balasan.`}
          </p>
        )}
      </div>
    </div>
  );
}

function newClientId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function Composer({ chatId, disabledReason }: { chatId: string; disabledReason: string | null }) {
  const [text, setText] = useState('');
  // Satu ID per niat kirim; dipakai ulang saat mencoba lagi setelah gagal agar tidak terkirim ganda.
  const clientId = useRef(newClientId());
  const send = useSend(chatId);

  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate(
      { text: body, clientMessageId: clientId.current },
      {
        onSuccess: () => {
          setText('');
          clientId.current = newClientId();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Pesan gagal dikirim'),
      },
    );
  };

  if (disabledReason)
    return (
      <p className="border-t bg-muted/40 p-3 text-center text-sm text-muted-foreground">
        {disabledReason}
      </p>
    );

  return (
    <div className="flex items-end gap-2 border-t p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        maxLength={WHATSAPP_MAX_MESSAGE_LENGTH}
        rows={2}
        placeholder="Tulis balasan… (Ctrl/⌘ + Enter untuk kirim)"
        aria-label="Balasan WhatsApp"
        className="min-h-12 resize-none"
      />
      <Button onClick={submit} disabled={!text.trim() || send.isPending} aria-label="Kirim pesan">
        {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        <span className="hidden sm:inline">Kirim</span>
      </Button>
    </div>
  );
}

function Thread({ chatId, onBack }: { chatId: string; onBack: () => void }) {
  const thread = useThread(chatId);
  const markRead = useMarkRead();
  const bottom = useRef<HTMLDivElement>(null);
  const unread = thread.data?.chat.unreadCount ?? 0;
  const count = thread.data?.messages.length ?? 0;

  useEffect(() => {
    if (unread > 0) markRead.mutate(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat jumlah belum dibaca berubah
  }, [chatId, unread]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chatId, count]);

  if (thread.isLoading || !thread.data)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );

  const { chat, messages, canReply, replyBlockedReason } = thread.data;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="Kembali ke daftar chat"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{chatTitle(chat)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chat.contactPhone
              ? chat.contactName
                ? `+${chat.contactPhone} · `
                : ''
              : 'Nomor disembunyikan WhatsApp · '}
            {`via ${chat.session.label}`}
            {!chat.mine && chat.owner && ` (milik ${chat.owner.name})`}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {canReply
              ? 'Belum ada pesan. Tulis pesan pertama Anda di bawah, secara personal.'
              : 'Belum ada pesan.'}
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        <div ref={bottom} />
      </div>
      <Composer
        key={chatId}
        chatId={chatId}
        disabledReason={canReply ? null : replyBlockedReason}
      />
    </div>
  );
}

const ALL_NUMBERS = 'all';

export function Inbox({ sessionLinked }: { sessionLinked: boolean }) {
  const mySessions = useSessions().data ?? [];
  const [numberFilter, setNumberFilter] = useState(ALL_NUMBERS);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDebounce(search, 300);
  const chats = useChats({
    search: q || undefined,
    unreadOnly,
    sessionId: numberFilter === ALL_NUMBERS ? undefined : numberFilter,
    page,
  });
  const items = useMemo(() => chats.data?.items ?? [], [chats.data]);

  return (
    <Card className="grid h-[calc(100dvh-16rem)] min-h-[28rem] grid-cols-1 overflow-hidden p-0 md:grid-cols-[22rem_1fr]">
      <div className={cn('flex min-h-0 flex-col border-r', selected && 'hidden md:flex')}>
        <div className="space-y-2 border-b p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari nama, nomor, atau pesan"
                aria-label="Cari chat"
                className="pl-8"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              title="Chat baru"
              aria-label="Chat baru"
              disabled={!sessionLinked}
              onClick={() => setNewChatOpen(true)}
            >
              <MessageSquarePlus />
            </Button>
          </div>
          {mySessions.length > 1 && (
            <Select
              value={numberFilter}
              onValueChange={(v) => {
                setNumberFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter nomor WhatsApp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_NUMBERS}>Semua nomor</SelectItem>
                {mySessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <button
            type="button"
            onClick={() => {
              setUnreadOnly((v) => !v);
              setPage(1);
            }}
            aria-pressed={unreadOnly}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Badge variant={unreadOnly ? 'default' : 'secondary'}>Belum dibaca</Badge>
            {chats.data && chats.data.unreadTotal > 0 && `${chats.data.unreadTotal} pesan baru`}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {chats.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title={q || unreadOnly ? 'Tidak ada chat yang cocok' : 'Belum ada chat'}
              description={
                q || unreadOnly
                  ? 'Ubah kata kunci atau filter.'
                  : sessionLinked
                    ? 'Chat muncul di sini saat ada pesan masuk ke nomor Anda.'
                    : 'Tautkan nomor di tab "Nomor saya" untuk mulai menerima chat.'
              }
            />
          ) : (
            <ul>
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    aria-current={selected === c.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-accent',
                      selected === c.id && 'bg-primary/10',
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-brand-text">
                      {chatTitle(c).replace(/^\+/, '').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-sm',
                            c.unreadCount > 0 ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {chatTitle(c)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatRelative(c.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.lastMessagePreview ?? 'Belum ada pesan'}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      {(mySessions.length > 1 || !c.mine) && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {!c.mine && c.owner ? `${c.owner.name} · ` : ''}
                          {c.session.label}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {chats.data && chats.data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t p-2 text-sm">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft /> Sebelumnya
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {page} / {chats.data.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= chats.data.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Berikutnya <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      <div className={cn('min-h-0', !selected && 'hidden md:block')}>
        {selected ? (
          <Thread chatId={selected} onBack={() => setSelected(null)} />
        ) : (
          <EmptyState
            icon={MessageCircle}
            title="Pilih chat"
            description="Pilih percakapan di kiri untuk membaca dan membalas."
            className="h-full"
          />
        )}
      </div>
      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onStarted={(id) => {
          setNewChatOpen(false);
          setNumberFilter(ALL_NUMBERS);
          setSearch('');
          setUnreadOnly(false);
          setPage(1);
          setSelected(id);
        }}
      />
    </Card>
  );
}
