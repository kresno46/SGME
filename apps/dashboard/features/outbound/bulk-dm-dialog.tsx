'use client';

import { PERMISSIONS, renderTemplate } from '@smge/shared';
import type { OutboundQueueItemDto, Paginated, TikTokAccountDto } from '@smge/types';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { FormError, FormField } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Textarea } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { useInvalidateOutbound, useOutboundSummary, useTemplates } from './api';

type QueuePage = Paginated<OutboundQueueItemDto> & { truncated: boolean };
const STEPS = ['Penerima', 'Pesan', 'Tinjau', 'Mulai kirim'];

export function BulkDmDialog({
  account,
  onClose,
}: {
  account: TikTokAccountDto;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const canApprove = can(PERMISSIONS.OUTREACH_REVIEW);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ queued: number; submitted: number } | null>(null);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const running = useRef(false);
  const invalidate = useInvalidateOutbound();
  const summary = useOutboundSummary(account.id);
  const templates = useTemplates(true);
  const queue = useQuery({
    queryKey: ['outbound', 'bulk-preview', account.id],
    queryFn: async () => {
      const items = new Map<string, OutboundQueueItemDto>();
      let truncated = false;
      for (let page = 1; page <= 5; page++) {
        const data = await api.get<QueuePage>('/outbound/queue', {
          accountId: account.id,
          channel: 'TIKTOK_DM',
          page,
          pageSize: 100,
        });
        for (const item of data.items) items.set(item.lead.id, item);
        truncated ||= data.truncated;
        if (page >= data.totalPages) break;
      }
      return { items: [...items.values()], truncated };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const remaining = summary.data
    ? Math.min(30, Math.max(0, summary.data.dailyLimit - summary.data.createdToday))
    : 0;
  const items = queue.data?.items ?? [];
  const ids = selected ?? new Set(items.slice(0, remaining).map(({ lead }) => lead.id));
  const recipients = items.filter(({ lead }) => ids.has(lead.id));
  const preview = ({ lead }: OutboundQueueItemDto) =>
    renderTemplate(message.trim(), {
      nama: lead.name,
      username: lead.tiktokUsername,
      akun: account.username,
    });
  const invalidMessage =
    message.trim().length < 5 ||
    recipients.some((item) => preview(item).length < 5 || preview(item).length > 2000);
  const unsupported = [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].some(
    (m) => !['nama', 'username', 'akun'].includes(m[1]),
  );
  const loadError = queue.error ?? summary.error;
  const loading = queue.isPending || summary.isPending;

  async function prepare() {
    if (running.current || !recipients.length || invalidMessage || unsupported) return;
    running.current = true;
    setBusy(true);
    setError(null);
    const body = {
      accountId: account.id,
      leadIds: recipients.map(({ lead }) => lead.id),
      message: message.trim(),
      mode: canApprove ? 'approve' : 'submit',
      confirmed: true,
    };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, requestId: crypto.randomUUID() };
    try {
      const data = await api.post<{ queued: number; submitted: number }>(
        '/outbound/browser-dm/prepare',
        { ...body, requestId: pending.current.requestId },
      );
      setResult(data);
      setStep(3);
      void invalidate();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Belum berhasil menyiapkan batch. Coba lagi dengan pilihan yang sama.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !running.current && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(event) => running.current && event.preventDefault()}
        onEscapeKeyDown={(event) => running.current && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Kirim DM · @{account.username}</DialogTitle>
          <DialogDescription>
            Pilih penerima, tulis pesan, lalu tinjau sebelum pengiriman.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="Langkah pengiriman">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className={`rounded-md p-2 ${step === index ? 'bg-primary text-primary-foreground font-semibold' : 'bg-muted text-muted-foreground'}`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
        <FormError message={error ?? loadError?.message ?? null} />
        {error && !busy && step < 3 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setSelected(null);
              setStep(0);
              void queue.refetch();
              void summary.refetch();
            }}
          >
            Perbarui penerima & kuota
          </Button>
        )}
        {step === 0 && (
          <div className="grid gap-3 text-sm">
            <p>
              Pilih maksimal <strong>{remaining} penerima</strong> sesuai kuota hari ini. Prospek
              dengan tugas berjalan atau larangan kontak dikecualikan.
            </p>
            {loading ? (
              <p role="status">
                <Loader2 className="inline size-4 animate-spin" /> Memuat penerima…
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span>
                    {ids.size} dipilih dari {items.length} kandidat
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelected(
                        ids.size
                          ? new Set()
                          : new Set(items.slice(0, remaining).map(({ lead }) => lead.id)),
                      )
                    }
                  >
                    {ids.size ? 'Kosongkan pilihan' : 'Pilih sesuai kuota'}
                  </Button>
                </div>
                <div
                  className="max-h-60 overflow-y-auto divide-y rounded-md border"
                  aria-label="Pilih penerima DM"
                >
                  {items.map(({ lead }) => (
                    <label key={lead.id} className="flex cursor-pointer items-center gap-3 p-3">
                      <input
                        type="checkbox"
                        checked={ids.has(lead.id)}
                        disabled={!ids.has(lead.id) && ids.size >= remaining}
                        onChange={(event) => {
                          const next = new Set(ids);
                          if (event.target.checked) next.add(lead.id);
                          else next.delete(lead.id);
                          setSelected(next);
                        }}
                      />
                      <span>
                        @{lead.tiktokUsername}
                        {lead.name && (
                          <span className="ml-2 text-muted-foreground">{lead.name}</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {!items.length && (
                    <p className="p-3 text-muted-foreground">
                      Belum ada penerima yang tersedia. Impor followers atau periksa tugas yang
                      sudah dibuat.
                    </p>
                  )}
                </div>
                {queue.data?.truncated && (
                  <p className="text-xs text-muted-foreground">
                    Menampilkan maksimal 500 kandidat terbaru.
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-4">
            <FormField label="Pakai template" htmlFor="bulk-template">
              <select
                id="bulk-template"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                defaultValue=""
                onChange={(event) => {
                  const tpl = templates.data?.find((t) => t.id === event.target.value);
                  if (tpl) setMessage(tpl.content);
                }}
              >
                <option value="">Tulis sendiri / pilih template</option>
                {templates.data
                  ?.filter((t) => !t.lane || t.lane === 'OUTBOUND')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              {templates.isError && (
                <p className="text-xs text-muted-foreground">
                  Template belum dapat dimuat. Pesan tetap bisa ditulis sendiri.
                </p>
              )}
            </FormField>
            <FormField
              label={`Pesan untuk ${recipients.length} penerima`}
              htmlFor="bulk-dm-message"
            >
              <Textarea
                id="bulk-dm-message"
                rows={6}
                maxLength={2000}
                value={message}
                placeholder="Halo {{nama}}, aku dari @{{akun}}…"
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {message.length}/2000 karakter · Personalisasi: {'{{nama}}, {{username}}, {{akun}}'}
                .
              </p>
              {unsupported && (
                <p className="text-sm text-destructive">
                  Panel ini mendukung nama, username, dan akun. Ganti variabel lain dengan teks atau
                  link yang ingin dikirim.
                </p>
              )}
            </FormField>
            {!!message && recipients[0] && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <p className="mb-2 text-xs text-muted-foreground">
                  Contoh untuk @{recipients[0].lead.tiktokUsername}
                </p>
                <p className="whitespace-pre-wrap">{preview(recipients[0])}</p>
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-3 text-sm">
            <p>
              Dari <strong>@{account.username}</strong> ke{' '}
              <strong>{recipients.length} penerima</strong>. Periksa pesan yang akan diterima
              masing-masing akun.
            </p>
            <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
              {recipients.map((item) => (
                <details key={item.lead.id} className="p-3" open={recipients.length === 1}>
                  <summary className="cursor-pointer font-medium">
                    @{item.lead.tiktokUsername}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{preview(item)}</p>
                </details>
              ))}
            </div>
            <p className="rounded-md bg-muted p-3">
              {canApprove
                ? 'Dengan Setujui & siapkan, seluruh pesan ini disetujui dan langsung masuk antrean. Pengiriman dimulai saat kamu menekan Mulai di extension.'
                : 'Pesan akan diajukan sekaligus untuk review Admin. Pengiriman menunggu persetujuan.'}
            </p>
          </div>
        )}
        {step === 3 && result && (
          <div className="grid gap-4 py-2">
            <CheckCircle2 className="size-9 text-green-600" />
            <p className="font-semibold">
              {result.queued
                ? `${result.queued} DM siap dikirim`
                : `${result.submitted} pesan diajukan untuk review`}
            </p>
            {result.queued ? (
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>
                  Pastikan TikTok di browser ini login sebagai <strong>@{account.username}</strong>.
                </li>
                <li>
                  Tutup panel ini, buka extension <strong>SMGE DM Sender</strong>, lalu tekan{' '}
                  <strong>Mulai dari tab Outbound ini</strong>.
                </li>
                <li>
                  Biarkan tab Outbound tetap terbuka. Hasil pengiriman muncul pada panel Status
                  pengiriman.
                </li>
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">
                Admin dapat memeriksa pesan pada tab Tugas → Menunggu review.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {result.queued
                ? 'Antrean sudah dibuat. Kamu tidak perlu review satu-satu atau klik antrekan lagi.'
                : 'Belum ada pesan yang dikirim.'}
            </p>
          </div>
        )}
        {account.status !== 'ACTIVE' && (
          <p className="text-sm text-destructive">Aktifkan akun sebelum melanjutkan.</p>
        )}
        <DialogFooter>
          {step > 0 && step < 3 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
            >
              <ChevronLeft /> Kembali
            </Button>
          )}
          {step === 0 && (
            <Button variant="outline" onClick={onClose}>
              Batal
            </Button>
          )}
          {step < 2 && (
            <Button
              disabled={
                loading ||
                !!loadError ||
                !recipients.length ||
                recipients.length > remaining ||
                account.status !== 'ACTIVE' ||
                (step === 1 && (invalidMessage || unsupported))
              }
              onClick={() => setStep(step + 1)}
            >
              {step === 0 ? 'Lanjut ke pesan' : 'Tinjau pengiriman'}
              <ChevronRight />
            </Button>
          )}
          {step === 2 && (
            <Button
              disabled={
                busy ||
                invalidMessage ||
                unsupported ||
                !recipients.length ||
                account.status !== 'ACTIVE'
              }
              onClick={() => void prepare()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {canApprove ? 'Setujui & siapkan' : 'Ajukan semua untuk review'}
            </Button>
          )}
          {step === 3 && (
            <Button onClick={onClose}>
              {result?.queued ? 'Lihat status & mulai extension' : 'Selesai'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
