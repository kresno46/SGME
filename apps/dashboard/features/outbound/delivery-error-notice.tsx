'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/overlays';

export type BrowserDelivery = {
  id: string;
  taskId: string;
  username: string;
  status: 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'UNVERIFIED' | 'CANCELLED';
  detail: string | null;
  senderUsername?: string;
  updatedAt?: string;
  attemptId?: string | null;
};

export function useDeliveryErrorNotice(rows: BrowserDelivery[] | undefined, scope: string) {
  const [pending, setPending] = useState<BrowserDelivery[]>([]);
  const remembered = useRef({ scope, events: new Set<string>() });
  useEffect(() => {
    // Notify after the query updates. Session storage prevents repeated polling/reload alerts.
    const timer = window.setTimeout(() => {
      const key = `mbg:dm-error-notices:${scope}`;
      let previous: string[] = [];
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
        if (Array.isArray(stored))
          previous = stored.filter((item): item is string => typeof item === 'string');
      } catch {
        /* Storage is optional; deduplication below still covers the current dialog queue. */
      }
      if (remembered.current.scope !== scope)
        remembered.current = { scope, events: new Set<string>() };
      const seen = remembered.current.events;
      previous.forEach((event) => seen.add(event));
      const additions = (rows ?? []).filter((row) => {
        if (row.status !== 'FAILED' && row.status !== 'UNVERIFIED') return false;
        const event = JSON.stringify([
          row.id,
          row.attemptId,
          row.updatedAt,
          row.status,
          row.detail,
        ]);
        if (seen.has(event)) return false;
        seen.add(event);
        return true;
      });
      if (!additions.length) return;
      try {
        sessionStorage.setItem(key, JSON.stringify([...seen].slice(-500)));
      } catch {
        /* Private browsing may block storage. */
      }
      setPending((current) => [
        ...current,
        ...additions.filter(
          (item) =>
            !current.some(
              (old) =>
                old.id === item.id &&
                old.attemptId === item.attemptId &&
                old.updatedAt === item.updatedAt &&
                old.status === item.status &&
                old.detail === item.detail,
            ),
        ),
      ]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rows, scope]);
  return {
    delivery: pending[0],
    dismiss: () => setPending((current) => current.slice(1)),
    show: (row: BrowserDelivery) =>
      setPending((current) => [row, ...current.filter((item) => item.id !== row.id)]),
  };
}

export function DeliveryErrorNotice({
  delivery,
  onClose,
}: {
  delivery: BrowserDelivery | undefined;
  onClose: () => void;
}) {
  if (!delivery) return null;
  const mismatch =
    /Akun TikTok login @([a-z0-9._]{2,24}) berbeda dengan pengirim @([a-z0-9._]{2,24})/i.exec(
      delivery.detail ?? '',
    );
  const accountError =
    !!mismatch ||
    /akun login.*(?:berbeda|tidak dapat)|akun pengirim belum|identitas pengirim belum|pengirim.*belum dapat diverifikasi/i.test(
      delivery.detail ?? '',
    );
  const uncertain = delivery.status === 'UNVERIFIED';
  const expected = delivery.senderUsername || mismatch?.[2];
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          {uncertain
            ? 'Periksa hasil pengiriman'
            : accountError
              ? 'Periksa akun TikTok pengirim'
              : 'Pengiriman DM gagal'}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {uncertain ? 'Hasil pesan ke' : 'Pesan ke'} @{delivery.username}{' '}
          {uncertain ? 'belum dapat dipastikan.' : 'belum berhasil dikirim.'}
        </AlertDialogDescription>
        {accountError && (
          <dl className="grid gap-2 rounded-md bg-muted p-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Pengirim antrean MBG</dt>
              <dd className="font-semibold">
                {expected ? `@${expected}` : 'Periksa akun pada tugas pengiriman'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Akun TikTok yang terdeteksi</dt>
              <dd className="font-semibold">
                {mismatch ? `@${mismatch[1]}` : 'Belum dapat dipastikan dari percobaan ini'}
              </dd>
            </div>
          </dl>
        )}
        <p className="break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {delivery.detail || 'Periksa chat TikTok dan akun pengirim sebelum melanjutkan.'}
        </p>
        <p className="text-sm text-muted-foreground">
          {uncertain
            ? 'Buka chat TikTok terlebih dahulu. Pilih konfirmasi terkirim atau tidak terkirim pada baris hasil sesuai pemeriksaan Anda. Jangan langsung mengirim ulang.'
            : accountError
              ? `Login TikTok sebagai ${expected ? `@${expected}` : 'akun pengirim antrean'}. Setelah memastikan pesan belum terkirim, gunakan Antrekan ulang. Mengubah dropdown tidak mengganti pengirim pada tugas lama.`
              : 'Perbaiki kendala yang tertera dan periksa chat TikTok. Gunakan Antrekan ulang hanya setelah memastikan pesan belum terkirim.'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <a href="https://www.tiktok.com/" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" /> Buka TikTok
            </a>
          </Button>
          <AlertDialogCancel>Mengerti</AlertDialogCancel>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
