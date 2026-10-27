'use client';

import { normalizePhone } from '@smge/shared';
import { Loader2, MessageSquarePlus, Phone, Search } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import { Input, Label, Skeleton } from '@/components/ui/primitives';
import { useDebounce } from '@/hooks/use-debounce';
import { useContacts, useSessions, useStartChat, useWhatsappConfig } from './api';

/** Berbentuk nomor telepon (angka, spasi, +, tanda hubung) dan cukup panjang. */
const looksLikePhone = (v: string) =>
  /^\+?[\d\s().-]+$/.test(v.trim()) && (normalizePhone(v)?.length ?? 0) >= 8;

/**
 * Memulai chat duluan: cari di kontak ponsel atau ketik nomor. Hanya membuat ruang chat; pesan pertama ditulis
 * dan dikirim oleh Anda sendiri, satu per satu.
 */
export function NewChatDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (chatId: string) => void;
}) {
  const working = (useSessions().data ?? []).filter((s) => s.status === 'WORKING');
  const config = useWhatsappConfig().data;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = useDebounce(query.trim(), 300);
  const active =
    sessionId && working.some((s) => s.id === sessionId) ? sessionId : (working[0]?.id ?? null);
  const contacts = useContacts(active, q, open);
  const start = useStartChat();

  const go = (phone: string, name?: string) => {
    if (!active) return;
    start.mutate(
      { sessionId: active, phone, name },
      {
        onSuccess: (chat) => {
          setQuery('');
          onStarted(chat.id);
        },
      },
    );
  };
  const typedPhone = looksLikePhone(query);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chat baru</DialogTitle>
          <DialogDescription>
            Pilih kontak atau ketik nomor. Ini hanya membuka percakapan; pesan pertama Anda tulis
            dan kirim sendiri.
          </DialogDescription>
        </DialogHeader>

        {working.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada nomor yang tersambung. Tautkan nomor di tab <b>Nomor saya</b> terlebih dahulu.
          </p>
        ) : (
          <div className="space-y-3">
            {working.length > 1 && (
              <div className="space-y-1.5">
                <Label>Kirim dari nomor</Label>
                <Select value={active ?? undefined} onValueChange={setSessionId}>
                  <SelectTrigger aria-label="Nomor pengirim">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {working.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                        {s.connectedNumber ? ` · ${s.connectedNumber}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari kontak atau ketik nomor (0812…)"
                aria-label="Cari kontak atau ketik nomor"
                className="pl-8"
                autoFocus
              />
            </div>

            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border" aria-live="polite">
              {typedPhone && (
                <li>
                  <button
                    type="button"
                    disabled={start.isPending}
                    onClick={() => go(query)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent disabled:opacity-60"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-brand-text">
                      {start.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Phone className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">Chat ke {query.trim()}</span>
                      <span className="block text-xs text-muted-foreground">
                        Nomor dicek dulu apakah terdaftar di WhatsApp
                      </span>
                    </span>
                  </button>
                </li>
              )}
              {contacts.isLoading && (
                <li className="space-y-2 p-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </li>
              )}
              {contacts.data?.available &&
                contacts.data.items.map((c) => (
                  <li key={c.phone}>
                    <button
                      type="button"
                      disabled={start.isPending}
                      onClick={() => go(c.phone, c.name)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent disabled:opacity-60"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-brand-text">
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">+{c.phone}</span>
                      </span>
                    </button>
                  </li>
                ))}
              {contacts.data?.available && contacts.data.items.length === 0 && !typedPhone && (
                <li className="p-4 text-center text-sm text-muted-foreground">
                  {q ? 'Tidak ada kontak yang cocok.' : 'Belum ada kontak tersinkron.'}
                </li>
              )}
              {contacts.data && !contacts.data.available && !typedPhone && (
                <li className="p-4 text-sm text-muted-foreground">
                  {config?.contactsSync
                    ? 'Kontak ponsel nomor ini belum tersinkron. Nomor yang tertaut sebelum sinkronisasi kontak diaktifkan perlu dipindai ulang. Ketik nomor lengkap untuk memulai chat.'
                    : 'Sinkronisasi kontak ponsel belum diaktifkan di server. Ketik nomor lengkap (mis. 0812…) untuk memulai chat.'}
                </li>
              )}
              {contacts.isError && !typedPhone && (
                <li className="p-4 text-sm text-muted-foreground">
                  Daftar kontak tidak dapat dimuat. Ketik nomor lengkap untuk memulai chat.
                </li>
              )}
            </ul>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <MessageSquarePlus className="mt-0.5 size-3.5 shrink-0" />
              Maksimal {config?.newChatsPerDay ?? 20} chat baru per nomor per hari. Chat yang sudah
              ada langsung dibuka. Kirim pesan pertama secara personal, satu per satu.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
