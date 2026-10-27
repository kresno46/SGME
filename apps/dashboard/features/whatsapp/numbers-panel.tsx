'use client';

import { whatsappNumberSchema, WHATSAPP_MAX_LABEL_LENGTH } from '@smge/shared';
import type { WhatsappConfigDto, WhatsappSessionDto } from '@smge/types';
import {
  History,
  Loader2,
  LogOut,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCcw,
  Smartphone,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatRelative } from '@/lib/utils';
import { ConfirmDialog, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from '@/components/ui/primitives';
import {
  useCreateSession,
  useRemoveSession,
  useRenameSession,
  useSessionAction,
  useSessions,
  useSyncHistory,
  useWhatsappConfig,
} from './api';
import { SessionStatusBadge } from './status';

/** Gambar QR dimuat ulang tiap 15 detik karena WAHA merotasinya; no-store dijamin oleh API. */
function QrImage({ sessionId }: { sessionId: string }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setFailed(false);
      setTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, []);
  if (failed)
    return (
      <p className="flex size-52 items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        QR belum siap. Tunggu beberapa detik…
      </p>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- QR dinamis dari API, bukan aset statis
    <img
      key={tick}
      src={`/api/whatsapp/sessions/${sessionId}/qr?t=${tick}`}
      alt="Kode QR untuk menautkan WhatsApp"
      width={208}
      height={208}
      className="size-52 rounded-lg border bg-white p-2"
      onError={() => setFailed(true)}
    />
  );
}

/** Dialog nama nomor, dipakai untuk menambah dan mengganti nama. */
function LabelDialog({
  open,
  title,
  description,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (label: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const parsed = whatsappNumberSchema.safeParse({ label: value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success) onSubmit(parsed.data.label);
          }}
        >
          <Label htmlFor="wa-label">Nama nomor</Label>
          <Input
            id="wa-label"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={WHATSAPP_MAX_LABEL_LENGTH}
            placeholder="mis. CS 1, Promo, Nomor pribadi"
            autoFocus
          />
          {!parsed.success && value.length > 0 && (
            <p className="text-sm text-destructive">{parsed.error.issues[0]?.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Batal
            </Button>
            <Button type="submit" disabled={!parsed.success || pending}>
              {pending && <Loader2 className="animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Penjelasan status impor riwayat chat dari ponsel pada satu nomor yang tersambung. */
function historyText(s: WhatsappSessionDto, config: WhatsappConfigDto | undefined) {
  if (s.historySyncing) return 'Menyinkronkan riwayat chat…';
  if (s.historyError === 'store_disabled')
    return 'Riwayat belum bisa disinkronkan: nomor ini ditautkan sebelum penyimpanan riwayat WAHA aktif. Putuskan nomor, Mulai sesi, Atur ulang sesi, lalu scan ulang.';
  if (s.historyError) return `Sinkronisasi riwayat gagal (${s.historyError}). Akan dicoba lagi.`;
  if (s.historySyncedAt)
    return `Riwayat tersinkron ${formatRelative(s.historySyncedAt)} · ${s.historyChats} chat (${config?.historyDays ?? 30} hari terakhir)`;
  return 'Menunggu sinkronisasi riwayat chat…';
}

function NumberCard({
  s,
  config,
}: {
  s: WhatsappSessionDto;
  config: WhatsappConfigDto | undefined;
}) {
  const [confirm, setConfirm] = useState<'logout' | 'reset' | 'remove' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const start = useSessionAction('start');
  const stop = useSessionAction('stop');
  const logout = useSessionAction('logout');
  const reset = useSessionAction('reset');
  const remove = useRemoveSession();
  const rename = useRenameSession();
  const syncHistory = useSyncHistory();

  const busy = [start, stop, logout, reset, remove].some((m) => m.isPending);
  const linked = s.status === 'WORKING';
  const waitingQr = s.status === 'SCAN_QR_CODE' || s.status === 'STARTING';
  const canStart = s.status === 'NOT_CREATED' || s.status === 'STOPPED' || s.status === 'FAILED';
  const canRemove = !linked && s.chatCount === 0;

  return (
    <Card className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-4">
        <CardHeader className="p-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Smartphone className="size-5 shrink-0 text-brand-text" />
            <span className="truncate">{s.label}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Ganti nama ${s.label}`}
              onClick={() => setRenaming(true)}
            >
              <Pencil />
            </Button>
          </CardTitle>
          <CardDescription>
            {s.chatCount > 0 ? `${s.chatCount} chat tersimpan` : 'Belum ada chat'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <div className="flex flex-wrap items-center gap-3">
            <SessionStatusBadge status={s.status} />
            {linked && (
              <span className="text-sm">
                {s.connectedName ?? 'Nomor tertaut'}
                {s.connectedNumber && (
                  <span className="text-muted-foreground"> · {s.connectedNumber}</span>
                )}
              </span>
            )}
            {s.problem && <span className="text-xs text-muted-foreground">kode: {s.problem}</span>}
          </div>

          {linked && config?.historySync && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <History className="size-4 shrink-0" />
                {historyText(s, config)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncHistory.mutate(s.id)}
                disabled={busy || syncHistory.isPending || s.historySyncing}
              >
                {s.historySyncing && <Loader2 className="animate-spin" />}
                Sinkronkan sekarang
              </Button>
            </div>
          )}

          {s.connectionLost && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Nomor terputus tanpa Anda memutuskannya. Mulai ulang sesi dan pindai QR bila diminta.
            </p>
          )}
          {s.eventsOutdated && (
            <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              Sesi ini dibuat sebelum status pengiriman dan pemantauan didaftarkan. Putuskan nomor
              lalu atur ulang sesi agar aktif.
            </p>
          )}
          {s.status === 'UNREACHABLE' && (
            <p className="text-sm text-muted-foreground">
              Server WAHA tidak menjawab. Chat yang sudah tersimpan tetap bisa dibaca.
            </p>
          )}
          {s.status === 'UNAUTHORIZED' && (
            <p className="text-sm text-muted-foreground">
              Kunci API WAHA ditolak. Periksa <code>WAHA_API_KEY</code> di server.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {canStart && (
              <Button onClick={() => start.mutate(s.id)} disabled={busy}>
                {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                {s.status === 'NOT_CREATED' ? 'Tautkan nomor' : 'Mulai sesi'}
              </Button>
            )}
            {(waitingQr || linked) && (
              <Button variant="outline" onClick={() => stop.mutate(s.id)} disabled={busy}>
                {stop.isPending ? <Loader2 className="animate-spin" /> : <Power />}
                Hentikan sesi
              </Button>
            )}
            {linked && (
              <Button variant="outline" onClick={() => setConfirm('logout')} disabled={busy}>
                <LogOut /> Putuskan nomor
              </Button>
            )}
            {!linked && s.status !== 'NOT_CREATED' && s.status !== 'NOT_CONFIGURED' && (
              <Button variant="ghost" onClick={() => setConfirm('reset')} disabled={busy}>
                <Wrench /> Atur ulang sesi
              </Button>
            )}
            {canRemove && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirm('remove')}
                disabled={busy}
              >
                <Trash2 /> Hapus nomor
              </Button>
            )}
          </div>
        </CardContent>
      </div>

      {s.status === 'SCAN_QR_CODE' && (
        <div className="flex flex-col items-center gap-2 sm:w-60">
          <QrImage sessionId={s.id} />
          <p className="text-center text-xs text-muted-foreground">
            WhatsApp di ponsel → Perangkat tertaut → Tautkan perangkat → arahkan kamera ke kode ini.
          </p>
        </div>
      )}

      <LabelDialog
        key={renaming ? 'open' : 'closed'}
        open={renaming}
        title="Ganti nama nomor"
        description="Nama hanya untuk membedakan nomor di SMGE."
        initial={s.label}
        submitLabel="Simpan"
        pending={rename.isPending}
        onClose={() => setRenaming(false)}
        onSubmit={(label) =>
          rename.mutate({ id: s.id, label }, { onSuccess: () => setRenaming(false) })
        }
      />
      <ConfirmDialog
        open={confirm === 'logout'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Putuskan nomor WhatsApp?"
        description="Nomor dilepas dari SMGE dan harus dipindai ulang untuk ditautkan lagi. Chat yang sudah tersimpan tetap ada."
        confirmLabel="Putuskan"
        destructive
        onConfirm={() => logout.mutateAsync(s.id)}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Atur ulang sesi?"
        description="Sesi yang macet dihapus dan dibuat ulang. Ditolak bila nomor masih tersambung; putuskan nomor lebih dulu."
        confirmLabel="Atur ulang"
        onConfirm={() => reset.mutateAsync(s.id)}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Hapus nomor "${s.label}"?`}
        description="Slot nomor ini dihapus dari SMGE dan WAHA. Hanya nomor tanpa chat yang bisa dihapus."
        confirmLabel="Hapus"
        destructive
        onConfirm={() => remove.mutateAsync(s.id)}
      />
    </Card>
  );
}

export function NumbersPanel() {
  const sessions = useSessions();
  const config = useWhatsappConfig();
  const create = useCreateSession();
  const [adding, setAdding] = useState(false);

  const list = sessions.data ?? [];
  const max = config.data?.maxSessionsPerUser ?? 1;
  const atLimit = list.length >= max;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {list.length} dari {max} nomor dipakai. Chat tiap nomor hanya terlihat oleh Anda dan Super
          Admin, dan balasan selalu keluar dari nomor tempat chat itu berada.
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Muat ulang status"
            onClick={() => void sessions.refetch()}
            disabled={sessions.isFetching}
          >
            <RefreshCcw className={sessions.isFetching ? 'animate-spin' : undefined} />
          </Button>
          <Button onClick={() => setAdding(true)} disabled={atLimit || create.isPending}>
            <Plus /> Tambah nomor
          </Button>
        </div>
      </div>

      {sessions.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={Smartphone}
            title="Belum ada nomor WhatsApp"
            description="Tambahkan nomor, beri nama, lalu pindai QR dari WhatsApp di ponsel. Gunakan nomor khusus, bukan nomor utama."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus /> Tambah nomor
              </Button>
            }
          />
        </Card>
      ) : (
        list.map((s) => <NumberCard key={s.id} s={s} config={config.data} />)
      )}

      <p className="text-xs text-muted-foreground">
        WAHA menjalankan WhatsApp Web di server dan bukan jalur resmi WhatsApp. Pemakaian otomatis
        dapat melanggar ketentuan WhatsApp dan nomor bisa diblokir. Gunakan nomor khusus, kirim
        pesan secara personal, dan hormati permintaan berhenti.
      </p>

      <LabelDialog
        key={adding ? 'open' : 'closed'}
        open={adding}
        title="Tambah nomor WhatsApp"
        description="Beri nama agar mudah dibedakan. Setelah ditambahkan, QR muncul untuk dipindai."
        initial={`Nomor ${list.length + 1}`}
        submitLabel="Tambah"
        pending={create.isPending}
        onClose={() => setAdding(false)}
        onSubmit={(label) => create.mutate({ label }, { onSuccess: () => setAdding(false) })}
      />
    </div>
  );
}
