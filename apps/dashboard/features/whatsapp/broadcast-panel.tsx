'use client';

import {
  WHATSAPP_BROADCAST_MAX_MESSAGE,
  normalizePhone,
  renderBroadcastMessage,
  unknownBroadcastPlaceholders,
} from '@smge/shared';
import type { WhatsappBroadcastDto } from '@smge/types';
import { Loader2, Pause, Play, Plus, Send, Users, X } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@/components/ui/primitives';
import { useDebounce } from '@/hooks/use-debounce';
import { formatDateTime, formatRelative } from '@/lib/utils';
import {
  useBroadcastAction,
  useBroadcastDetail,
  useBroadcasts,
  useContacts,
  useCreateBroadcast,
  useSessions,
  useWhatsappConfig,
} from './api';

const STATUS: Record<
  WhatsappBroadcastDto['status'],
  { label: string; variant: 'default' | 'warning' | 'success' | 'secondary' }
> = {
  RUNNING: { label: 'Berjalan', variant: 'default' },
  PAUSED: { label: 'Dijeda', variant: 'warning' },
  DONE: { label: 'Selesai', variant: 'success' },
  CANCELLED: { label: 'Dibatalkan', variant: 'secondary' },
};

const PAUSE_TEXT: Record<string, string> = {
  manual: 'Dijeda oleh Anda.',
  session_not_connected: 'Dijeda karena nomor terputus. Sambungkan nomor lalu lanjutkan.',
  too_many_failures:
    'Dijeda otomatis setelah 3 kegagalan berturut-turut. Periksa nomor dan daftar penerima.',
  waha_unavailable: 'Dijeda karena WAHA tidak dapat dijangkau.',
  owner_unavailable: 'Dijeda karena akun pemilik tidak aktif.',
};

const REASON_TEXT: Record<string, string> = {
  dnc: 'Ada di daftar larangan kontak',
  opt_out: 'Pernah minta berhenti',
  not_registered: 'Tidak terdaftar di WhatsApp',
  self: 'Nomor Anda sendiri',
  cancelled: 'Dibatalkan',
};
const reasonText = (r: string | null) =>
  !r
    ? ''
    : (REASON_TEXT[r] ??
      (r === 'send_failed:timeout'
        ? 'Waktu habis, status tidak pasti: periksa ponsel sebelum mengirim ulang'
        : `Gagal kirim (${r.replace('send_failed:', '')})`));

const RECIPIENT_BADGE = {
  PENDING: { label: 'Menunggu', variant: 'secondary' },
  SENT: { label: 'Terkirim', variant: 'success' },
  FAILED: { label: 'Gagal', variant: 'destructive' },
  SKIPPED: { label: 'Dilewati', variant: 'warning' },
} as const;

/** Satu baris per penerima: "nomor" atau "nama, nomor". Baris tanpa nomor yang valid dihitung salah. */
export function parseRecipients(text: string) {
  const ok: Array<{ phone: string; name?: string }> = [];
  let invalid = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t
      .split(/[,;\t]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const phone = parts.find(
      (p) => /^\+?[\d\s().-]+$/.test(p) && (normalizePhone(p)?.length ?? 0) >= 8,
    );
    if (!phone) {
      invalid++;
      continue;
    }
    const name = parts.find((p) => p !== phone);
    ok.push({ phone, ...(name ? { name } : {}) });
  }
  return { ok, invalid };
}

type Picked = Record<string, { phone: string; name: string }>;

/** Daftar kontak yang tersimpan di ponsel, dengan centang; bisa pilih banyak sekaligus sampai batas penerima. */
function ContactPicker({
  sessionId,
  picked,
  full,
  onToggle,
  onClear,
}: {
  sessionId: string | null;
  picked: Picked;
  full: boolean;
  onToggle: (c: { phone: string; name: string }) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const search = useDebounce(q.trim(), 300);
  const contacts = useContacts(sessionId, search, true, true);
  if (contacts.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!contacts.data?.available) return null;
  const chosen = Object.values(picked);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="bc-contact">Pilih dari kontak tersimpan</Label>
        {chosen.length > 0 && (
          <button type="button" className="text-xs underline" onClick={onClear}>
            Hapus {chosen.length} pilihan
          </button>
        )}
      </div>
      <Input
        id="bc-contact"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari nama kontak"
      />
      <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm">
        {contacts.data.items.length === 0 && (
          <li className="p-2.5 text-muted-foreground">Tidak ada kontak tersimpan yang cocok.</li>
        )}
        {contacts.data.items.map((c) => (
          <li key={c.phone}>
            <label className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2 hover:bg-accent">
              <Checkbox
                checked={!!picked[c.phone]}
                disabled={full && !picked[c.phone]}
                onChange={() => onToggle(c)}
              />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">+{c.phone}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {q
          ? `${contacts.data.items.length} kontak tersimpan cocok.`
          : 'Menampilkan kontak tersimpan teratas. Cari nama untuk menemukan yang lain.'}
      </p>
      {chosen.length > 0 && (
        <ul className="flex max-h-20 flex-wrap gap-1 overflow-y-auto" aria-label="Kontak terpilih">
          {chosen.map((c) => (
            <li key={c.phone}>
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs hover:bg-accent"
                aria-label={`Hapus ${c.name}`}
                onClick={() => onToggle(c)}
              >
                {c.name} <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewBroadcastDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const working = (useSessions().data ?? []).filter((s) => s.status === 'WORKING');
  const cfg = useWhatsappConfig().data?.broadcast;
  const create = useCreateBroadcast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [list, setList] = useState('');
  const [picked, setPicked] = useState<Picked>({});
  const [consent, setConsent] = useState(false);

  const active =
    sessionId && working.some((s) => s.id === sessionId) ? sessionId : (working[0]?.id ?? null);
  const { ok, invalid } = parseRecipients(list);
  const recipients = [...Object.values(picked), ...ok];
  const unique = new Set(recipients.map((r) => normalizePhone(r.phone))).size;
  const unknown = unknownBroadcastPlaceholders(message);
  const max = cfg?.maxRecipients ?? 50;
  const avgDelay = ((cfg?.minDelaySeconds ?? 20) + (cfg?.maxDelaySeconds ?? 60)) / 2;
  const minutes = Math.max(1, Math.round((unique * avgDelay) / 60));
  const days = cfg ? Math.ceil(unique / cfg.perDay) : 1;
  const valid =
    !!active &&
    name.trim().length > 0 &&
    message.trim().length >= 5 &&
    unknown.length === 0 &&
    unique > 0 &&
    unique <= max &&
    invalid === 0 &&
    consent;

  const submit = () => {
    if (!valid || !active) return;
    create.mutate(
      {
        sessionId: active,
        name: name.trim(),
        message: message.trim(),
        recipients,
        consent: true,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Kirim terjadwal baru</DialogTitle>
          <DialogDescription>
            Satu pesan ke daftar kecil orang yang Anda kenal. Dikirim bertahap dengan jeda acak,
            bukan sekaligus.
          </DialogDescription>
        </DialogHeader>
        {working.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada nomor yang tersambung.</p>
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
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bc-name">Nama (hanya untuk Anda)</Label>
              <Input
                id="bc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-message">Pesan</Label>
              <Textarea
                id="bc-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={WHATSAPP_BROADCAST_MAX_MESSAGE}
                placeholder="Halo {{nama}}, ..."
              />
              {unknown.length > 0 ? (
                <p className="text-xs text-destructive">
                  Variabel tidak dikenal: {unknown.map((u) => `{{${u}}}`).join(', ')}. Hanya{' '}
                  {'{{nama}}'} yang tersedia.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {'{{nama}}'} diganti nama penerima (atau &quot;kak&quot; bila tidak ada). Contoh:{' '}
                  <span className="text-foreground">
                    {renderBroadcastMessage(message || '…', recipients[0]?.name)}
                  </span>
                </p>
              )}
            </div>
            <ContactPicker
              sessionId={active}
              picked={picked}
              full={unique >= max}
              onToggle={(c) =>
                setPicked((p) => {
                  const next = { ...p };
                  if (next[c.phone]) delete next[c.phone];
                  else next[c.phone] = { phone: c.phone, name: c.name };
                  return next;
                })
              }
              onClear={() => setPicked({})}
            />
            <div className="space-y-1.5">
              <Label htmlFor="bc-list">
                Atau ketik nomor (satu per baris: nomor, atau nama, nomor)
              </Label>
              <Textarea
                id="bc-list"
                value={list}
                onChange={(e) => setList(e.target.value)}
                rows={5}
                placeholder={'Budi, 0812 3456 7890\n0813 1111 2222'}
              />
              <p
                className={
                  invalid || unique > max
                    ? 'text-xs text-destructive'
                    : 'text-xs text-muted-foreground'
                }
              >
                {unique} penerima unik (maks. {max})
                {invalid > 0 ? ` · ${invalid} baris tidak valid` : ''}
              </p>
            </div>
            {unique > 0 && cfg && (
              <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
                Perkiraan selesai ±{minutes} menit (jeda {cfg.minDelaySeconds} sampai{' '}
                {cfg.maxDelaySeconds} detik). Batas {cfg.perDay} pesan per nomor per hari
                {days > 1 ? `, jadi berlangsung ${days} hari` : ''}. Nomor di daftar larangan kontak
                dan yang pernah minta berhenti dilewati otomatis.
              </p>
            )}
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Saya konfirmasi semua penerima mengenal saya dan setuju dihubungi lewat WhatsApp.
              </span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Mulai kirim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Recipients({ id }: { id: string }) {
  const detail = useBroadcastDetail(id);
  if (detail.isLoading || !detail.data) return <Skeleton className="h-24 w-full" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Penerima</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Keterangan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {detail.data.recipients.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <span className="font-medium">{r.name ?? 'Tanpa nama'}</span>
              <span className="block text-xs text-muted-foreground">+{r.phone}</span>
            </TableCell>
            <TableCell>
              <Badge variant={RECIPIENT_BADGE[r.status].variant}>
                {RECIPIENT_BADGE[r.status].label}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {r.status === 'SENT' ? formatDateTime(r.sentAt) : reasonText(r.reason)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BroadcastCard({ b }: { b: WhatsappBroadcastDto }) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pause = useBroadcastAction('pause');
  const resume = useBroadcastAction('resume');
  const cancel = useBroadcastAction('cancel');
  const st = STATUS[b.status];
  const done = b.sent + b.skipped + b.failed;
  const pct = b.total ? Math.round((done / b.total) * 100) : 0;
  const active = b.status === 'RUNNING' || b.status === 'PAUSED';

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{b.name}</span>
            <Badge variant={st.variant}>{st.label}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            dari {b.sessionLabel} · dibuat {formatRelative(b.createdAt)}
          </p>
        </div>
        {active && (
          <div className="flex gap-2">
            {b.status === 'RUNNING' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => pause.mutate(b.id)}
                disabled={pause.isPending}
              >
                <Pause /> Jeda
              </Button>
            ) : (
              <Button size="sm" onClick={() => resume.mutate(b.id)} disabled={resume.isPending}>
                <Play /> Lanjutkan
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
              <X /> Batalkan
            </Button>
          </div>
        )}
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Kemajuan ${b.name}`}
      >
        <div
          className={`h-full transition-all ${b.status === 'CANCELLED' ? 'bg-muted-foreground/40' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {b.sent} terkirim dari {b.total}
        {b.skipped > 0 && ` · ${b.skipped} dilewati`}
        {b.failed > 0 && ` · ${b.failed} gagal`}
        {b.pending > 0 && ` · ${b.pending} menunggu`}
        {b.status === 'RUNNING' && b.nextSendAt && ` · berikutnya ${formatRelative(b.nextSendAt)}`}
      </p>
      {b.status === 'PAUSED' && b.pauseReason && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm">
          {PAUSE_TEXT[b.pauseReason] ?? 'Dijeda.'}
        </p>
      )}
      <p className="line-clamp-2 rounded-md bg-muted/50 p-2.5 text-sm">{b.message}</p>

      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Users /> {open ? 'Sembunyikan penerima' : 'Lihat penerima'}
      </Button>
      {open && <Recipients id={b.id} />}

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Batalkan "${b.name}"?`}
        description="Penerima yang belum dikirimi ditandai dilewati. Pesan yang sudah terkirim tidak bisa ditarik."
        confirmLabel="Batalkan pengiriman"
        destructive
        onConfirm={() => cancel.mutateAsync(b.id)}
      />
    </Card>
  );
}

export function BroadcastPanel() {
  const cfg = useWhatsappConfig().data?.broadcast;
  const list = useBroadcasts(!!cfg?.enabled);
  const sessions = useSessions().data ?? [];
  const [creating, setCreating] = useState(false);
  const canCreate = sessions.some((s) => s.status === 'WORKING');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Kirim satu pesan ke daftar kecil orang yang Anda kenal, bertahap dengan jeda acak (maks.{' '}
          {cfg?.maxRecipients ?? 50} penerima, {cfg?.perDay ?? 30} pesan per nomor per hari). Bukan
          untuk nomor yang belum pernah berinteraksi: WhatsApp dapat memblokir nomor yang mengirim
          pesan massal.
        </p>
        <Button onClick={() => setCreating(true)} disabled={!canCreate}>
          <Plus /> Kirim terjadwal baru
        </Button>
      </div>
      {list.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (list.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={Send}
            title="Belum ada pengiriman terjadwal"
            description={
              canCreate
                ? 'Buat pengiriman pertama: tulis pesan, tambahkan penerima, lalu SMGE mengirimnya bertahap.'
                : 'Tautkan nomor dan tunggu status Terhubung untuk membuat pengiriman.'
            }
          />
        </Card>
      ) : (
        list.data!.map((b) => <BroadcastCard key={b.id} b={b} />)
      )}
      <NewBroadcastDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
