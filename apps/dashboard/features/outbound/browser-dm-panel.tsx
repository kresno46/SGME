'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Send, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FormError } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { useInvalidateOutbound, useOutboundSummary } from './api';

type Delivery = {
  id: string;
  taskId: string;
  username: string;
  status: 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'UNVERIFIED' | 'CANCELLED';
  detail: string | null;
};
const labels = {
  QUEUED: 'Menunggu extension',
  PROCESSING: 'Sedang diproses',
  SENT: 'Terlihat terkirim / dikonfirmasi',
  FAILED: 'Gagal',
  UNVERIFIED: 'Perlu diperiksa di TikTok',
  CANCELLED: 'Dibatalkan',
};

export function BrowserDmPanel({ accountId }: { accountId: string }) {
  const { user } = useAuth();
  const simple = user.role === 'MARKETING_OPERATOR';
  const summary = useOutboundSummary(accountId);
  const approved =
    (summary.data?.byStatus.APPROVED ?? 0) +
    (summary.data?.byStatus.WAITING_REVIEW ?? 0) +
    (summary.data?.byStatus.DRAFT ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const invalidate = useInvalidateOutbound();
  const q = useQuery({
    queryKey: ['outbound', 'browser-dm', accountId],
    queryFn: () => api.get<Delivery[]>('/outbound/browser-dm', { accountId }),
    refetchInterval: 5000,
  });
  const waiting = q.data?.filter((r) => r.status === 'QUEUED').length ?? 0;
  const processing = q.data?.filter((r) => r.status === 'PROCESSING').length ?? 0;
  const uncertain = q.data?.filter((r) => r.status === 'UNVERIFIED').length ?? 0;
  const failed = q.data?.filter((r) => r.status === 'FAILED').length ?? 0;
  const sent = q.data?.filter((r) => r.status === 'SENT').length ?? 0;
  async function perform(path: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await api.post<{ queued?: number }>(`/outbound/browser-dm/${path}`, body);
      if (path === 'queue' || path.endsWith('/retry'))
        setNotice(
          result.queued
            ? `${result.queued} tugas masuk antrean. Klik Mulai di extension SMGE DM Sender dari tab Outbound ini.`
            : 'Tidak ada tugas baru untuk diantrekan. Untuk baris Gagal, periksa chat lalu gunakan Antrekan ulang pada baris tersebut.',
        );
      else if (path === 'cancel')
        setNotice(
          'Antrean yang belum dimulai dibatalkan. Percobaan aktif tetap dicatat sampai selesai.',
        );
      await invalidate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeCancelled(row: Delivery) {
    if (
      busy ||
      !window.confirm(
        `Hapus @${row.username} dari daftar pengiriman yang dibatalkan? Riwayat tugas tetap disimpan.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await api.delete('/outbound/browser-dm/' + row.id);
      await invalidate();
      setNotice('Pengiriman yang dibatalkan sudah dihapus dari daftar.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card id="dm-delivery-status" className="mt-4 p-4">
      <h2 className="font-semibold">Status pengiriman</h2>
      <p role="status" className="mt-1 text-sm text-muted-foreground">
        {uncertain
          ? `${uncertain} pengiriman perlu diperiksa di TikTok sebelum melanjutkan.`
          : processing
            ? `${processing} DM sedang diproses. Biarkan tab ini terbuka.`
            : waiting
              ? `${waiting} DM siap. Buka extension SMGE DM Sender, lalu klik Mulai dari tab Outbound ini.`
              : approved > 0
                ? `${approved} pesan belum masuk antrean. Klik Masukkan pesan ke antrean untuk melanjutkan.`
                : 'Mulai dari tombol Kirim DM untuk memilih penerima dan menyiapkan pesan.'}
      </p>
      {!!q.data?.length && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <span>{waiting} menunggu</span>
          <span>{processing} diproses</span>
          <span>{sent} terkirim / dikonfirmasi</span>
          <span>{failed + uncertain} perlu tindakan</span>
        </div>
      )}
      {approved > 0 && !waiting && !processing && !uncertain && (
        <Button
          className="mt-3"
          size="sm"
          disabled={busy}
          onClick={() => void perform('queue', { accountId })}
        >
          <Send /> Masukkan pesan ke antrean
        </Button>
      )}
      {!!waiting && (
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void perform('cancel', { accountId })}
        >
          <Square /> Batalkan yang menunggu
        </Button>
      )}
      <details className="mt-3 rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Pasang extension / bantuan pengiriman
        </summary>
        <div className="my-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href="/downloads/smge-browser-dm-sender.zip?v=0.2.4" download>
              <Download /> Unduh DM Sender
            </a>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ekstrak ZIP, pasang melalui Load unpacked di chrome://extensions atau edge://extensions.
          Pilih akun pada dropdown Outbound, buka extension, lalu Mulai. Tab dashboard harus tetap
          login. Hasil di bawah diperbarui setiap 5 detik.
        </p>
        {!simple && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              Punya pesan yang belum masuk antrean? Masukkan ke antrean di sini. Pesan yang gagal
              harus diperiksa dan dicoba ulang dari baris hasilnya.
            </p>
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void perform('queue', { accountId })}
            >
              <Send /> Masukkan pesan ke antrean
            </Button>
          </>
        )}
      </details>
      <FormError message={error ?? q.error?.message ?? null} />
      {notice && (
        <p role="status" className="mt-2 text-sm">
          {notice}
        </p>
      )}
      {q.isPending ? (
        <p className="mt-2 text-sm">Memuat hasil…</p>
      ) : q.data?.length ? (
        <div className="mt-3 max-h-64 overflow-y-auto divide-y rounded-md border">
          {q.data.map((row) => (
            <div key={row.id} className="p-2 text-sm">
              <p>
                <strong>@{row.username}</strong> · {labels[row.status]}
              </p>
              {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
              {row.status === 'SENT' && (
                <Button className="mt-2" size="sm" variant="outline" asChild>
                  <Link href={`/outbound?account=${accountId}&tab=tasks&task=${row.taskId}`}>
                    Buka tugas / follow-up
                  </Link>
                </Button>
              )}
              {row.status === 'CANCELLED' && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void removeCancelled(row)}
                >
                  <Trash2 /> Hapus dari daftar
                </Button>
              )}
              {row.status === 'FAILED' && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Sudah memeriksa chat @${row.username} dan memastikan pesan belum terkirim? Klik OK untuk mengantrekan ulang satu tugas ini.`,
                      )
                    )
                      void perform(`${row.id}/retry`, { confirmedNotSent: true });
                  }}
                >
                  Antrekan ulang
                </Button>
              )}
              {row.status === 'UNVERIFIED' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <p className="w-full text-xs">
                    Buka chat TikTok dan periksa sebelum memilih konfirmasi:
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void perform(`${row.id}/resolve`, { confirmed: true, sent: true })
                    }
                  >
                    Sudah diperiksa: terkirim
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void perform(`${row.id}/resolve`, { confirmed: true, sent: false })
                    }
                  >
                    Sudah diperiksa: tidak terkirim
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        !q.isError && (
          <p className="mt-2 text-xs text-muted-foreground">Belum ada pengiriman untuk akun ini.</p>
        )
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Terlihat terkirim berarti pesan baru teramati di chat browser; bukan konfirmasi API atau
        bukti dibaca. Percobaan yang hasilnya belum jelas tidak diulang otomatis.
      </p>
    </Card>
  );
}
