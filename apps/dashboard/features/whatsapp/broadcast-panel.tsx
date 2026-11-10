'use client';

import {
  BROADCAST_ATTACHMENT_MAX_BYTES,
  WHATSAPP_BROADCAST_MAX_MESSAGE,
  WHATSAPP_CAPTION_MAX_LENGTH,
  WHATSAPP_CHECK_BATCH,
  broadcastReasonText,
  broadcastTemplateProblems,
  broadcastUsedVars,
  normalizePhone,
  renderBroadcastMessage,
  type BroadcastVars,
  type ExtractedRecipient,
} from '@smge/shared';
import type {
  WhatsappAttachmentDto,
  WhatsappBroadcastDto,
  WhatsappNumberCheckDto,
} from '@smge/types';
import {
  Download,
  FileUp,
  ListChecks,
  Loader2,
  Paperclip,
  Pause,
  Play,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { api, downloadUrl } from '@/lib/api';
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
  attachment_missing:
    'Dijeda karena berkas lampiran tidak ditemukan. Batalkan pengiriman ini, lalu buat ulang dengan lampiran.',
};

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

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
        <span className="flex items-center gap-3">
          {chosen.length > 0 && (
            <button type="button" className="text-xs underline" onClick={onClear}>
              Hapus {chosen.length} pilihan
            </button>
          )}
          <a
            className="text-xs underline"
            href={downloadUrl(`/whatsapp/sessions/${sessionId}/contacts/export`, {})}
            download
            title="Seluruh kontak tersimpan di ponsel nomor ini. File berisi data pribadi, simpan dengan hati-hati."
          >
            Unduh semua kontak (CSV)
          </a>
        </span>
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

/** Satu baris "nama, nomor" per penerima; koma di dalam nama diganti spasi agar tidak memecah kolom. */
const toLines = (rs: Array<{ phone: string; name?: string }>) =>
  rs.map((r) =>
    r.name ? `${r.name.replace(/\s*[,;\t\r\n]+\s*/g, ' ').trim()}, ${r.phone}` : r.phone,
  );

/** Membaca file CSV/Excel di server lalu menambahkan penerimanya ke kolom daftar; tidak menyimpan apa pun. */
interface ImportResult {
  recipients: ExtractedRecipient[];
  invalid: number;
  variables: string[];
}

function RecipientFileImport({ onImport }: { onImport: (r: ImportResult) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api.upload<ImportResult>('/whatsapp/broadcasts/import-recipients', form);
      if (r.recipients.length === 0) {
        setNote({ text: 'Tidak ada nomor yang valid di file ini.', error: true });
      } else {
        onImport(r);
        setNote({
          text: `${r.recipients.length} penerima ditambahkan dari ${file.name}${
            r.invalid > 0 ? `, ${r.invalid} baris tanpa nomor valid dilewati` : ''
          }.${
            r.variables.length > 0
              ? ` Variabel dari kolom: ${r.variables.map((v) => `{{${v}}}`).join(', ')}.`
              : ''
          } Periksa daftarnya sebelum mengirim.`,
          error: false,
        });
      }
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'File gagal dibaca.', error: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        id="bc-file"
        type="file"
        accept=".csv,.txt,.xlsx"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
        Impor dari CSV / Excel
      </Button>
      <p className="text-xs text-muted-foreground">
        Kolom <span className="text-foreground">nama</span> dan{' '}
        <span className="text-foreground">nomor</span> (header boleh ada atau tidak). Dengan header,
        kolom lain bisa dipakai di pesan, mis. kolom Kota menjadi{' '}
        <span className="text-foreground">{'{{kota}}'}</span>. Maks. 1000 baris, 1 MB.
      </p>
      {note && (
        <p
          role={note.error ? 'alert' : 'status'}
          className={note.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

type CheckStatus = WhatsappNumberCheckDto['results'][number]['status'];

/**
 * Mengecek nomor terdaftar di WhatsApp atau tidak sebelum dikirim, per kelompok kecil supaya progres terlihat
 * dan tiap permintaan singkat. Hasil tidak mengubah daftar; nomor tidak terdaftar baru dihapus bila Anda memilihnya.
 */
function NumberCheck({
  sessionId,
  phones,
  onRemove,
}: {
  sessionId: string | null;
  phones: string[];
  onRemove: (phones: Set<string>) => void;
}) {
  const [results, setResults] = useState<Record<string, CheckStatus>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const known = (p: string) => results[p] === 'registered' || results[p] === 'not_registered';
  const todo = phones.filter((p) => !known(p));
  const registered = phones.filter((p) => results[p] === 'registered').length;
  const missing = phones.filter((p) => results[p] === 'not_registered');

  const run = async () => {
    if (!sessionId) return;
    setError(null);
    try {
      for (let i = 0; i < todo.length; i += WHATSAPP_CHECK_BATCH) {
        if (!alive.current) return;
        setProgress({ done: i, total: todo.length });
        const r = await api.post<WhatsappNumberCheckDto>(
          `/whatsapp/sessions/${sessionId}/check-numbers`,
          { phones: todo.slice(i, i + WHATSAPP_CHECK_BATCH) },
        );
        if (!alive.current) return;
        setResults((cur) => {
          const next = { ...cur };
          for (const x of r.results) if (x.status !== 'unchecked') next[x.phone] = x.status;
          return next;
        });
        if (r.results.some((x) => x.status === 'unchecked')) {
          setError('Pengecekan berhenti karena WAHA bermasalah. Coba lagi nanti.');
          return;
        }
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Pengecekan gagal.');
    } finally {
      if (alive.current) setProgress(null);
    }
  };

  const checked = phones.length - todo.length;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void run()}
          disabled={!sessionId || phones.length === 0 || todo.length === 0 || !!progress}
        >
          {progress ? <Loader2 className="animate-spin" /> : <ListChecks />}
          {progress
            ? `Mengecek ${Math.min(progress.done + WHATSAPP_CHECK_BATCH, progress.total)} dari ${progress.total}…`
            : checked > 0 && todo.length > 0
              ? `Cek ${todo.length} nomor yang belum dicek`
              : 'Cek nomor di WhatsApp'}
        </Button>
        {missing.length > 0 && !progress && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRemove(new Set(missing))}
          >
            <X /> Hapus {missing.length} yang tidak terdaftar
          </Button>
        )}
      </div>
      {checked > 0 ? (
        <p
          role="status"
          className={missing.length ? 'text-xs text-foreground' : 'text-xs text-muted-foreground'}
        >
          {registered} terdaftar
          {missing.length > 0 ? ` · ${missing.length} tidak terdaftar` : ''}
          {todo.length > 0 ? ` · ${todo.length} belum dicek` : ''}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Opsional. Nomor dicek satu per satu ke WhatsApp (sekitar setengah detik per nomor) tanpa
          mengirim pesan. Saat giliran kirim, setiap nomor tetap dicek lagi.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Satu lampiran JPEG atau PDF yang dikirim bersama pesan (pesan menjadi caption). Berkas diunggah ke server begitu
 * dipilih; "Hapus" hanya melepasnya dari form, dan sisa unggahan dibersihkan server.
 */
function AttachmentPicker({
  attachment,
  onChange,
}: {
  attachment: WhatsappAttachmentDto | null;
  onChange: (a: WhatsappAttachmentDto | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > BROADCAST_ATTACHMENT_MAX_BYTES) {
      setError('Berkas terlalu besar. Gambar maks. 5 MB, PDF maks. 10 MB.');
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      onChange(await api.upload<WhatsappAttachmentDto>('/whatsapp/broadcasts/attachments', form));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Berkas gagal diunggah.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        id="bc-attachment"
        type="file"
        accept=".jpg,.jpeg,.pdf,image/jpeg,application/pdf"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Paperclip />}
          {attachment ? 'Ganti lampiran' : 'Lampirkan gambar atau PDF'}
        </Button>
        {attachment && (
          <span className="flex min-w-0 items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs">
            <span className="truncate">{attachment.filename}</span>
            <span className="shrink-0 text-muted-foreground">({formatSize(attachment.size)})</span>
            <button
              type="button"
              className="shrink-0 rounded hover:bg-accent"
              aria-label={`Hapus lampiran ${attachment.filename}`}
              onClick={() => onChange(null)}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Opsional. JPEG (maks. 5 MB) atau PDF (maks. 10 MB); gambar PNG/WebP ubah ke JPEG dulu. Pesan
        menjadi keterangan di bawah lampiran (maks. {WHATSAPP_CAPTION_MAX_LENGTH} karakter), dan
        berkas dihapus dari server setelah pengiriman selesai.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
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
  const [attachment, setAttachment] = useState<WhatsappAttachmentDto | null>(null);
  /** Variabel dari kolom file per nomor (ternormalisasi), dan nama-nama variabel yang pernah diimpor. */
  const [fileVars, setFileVars] = useState<Record<string, BroadcastVars>>({});
  const [varNames, setVarNames] = useState<string[]>([]);

  const active =
    sessionId && working.some((s) => s.id === sessionId) ? sessionId : (working[0]?.id ?? null);
  const { ok, invalid } = parseRecipients(list);
  // Satu penerima per nomor (yang pertama menang): yang dikirim sama dengan yang dihitung, dan file besar dengan
  // banyak baris ganda tidak melewati batas 200 baris di schema.
  const recipients = (() => {
    const seen = new Set<string>();
    return [...Object.values(picked), ...ok].filter((r) => {
      const p = normalizePhone(r.phone);
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  })();
  const phones = recipients.map((r) => normalizePhone(r.phone) as string);
  const unique = phones.length;
  // Hanya variabel yang dipakai pesan yang dikirim ke server (kolom lain seperti email tidak ikut).
  const used = broadcastUsedVars(message);
  const withVars = recipients.map((r, i): ExtractedRecipient => {
    const src = fileVars[phones[i]];
    const vars: BroadcastVars = {};
    for (const k of used) if (src?.[k]) vars[k] = src[k];
    return Object.keys(vars).length > 0 ? { ...r, vars } : r;
  });
  const problems = broadcastTemplateProblems(
    message.trim(),
    withVars,
    attachment ? WHATSAPP_CAPTION_MAX_LENGTH : undefined,
  );
  const max = cfg?.maxRecipients ?? 50;
  const avgDelay = ((cfg?.minDelaySeconds ?? 20) + (cfg?.maxDelaySeconds ?? 60)) / 2;
  const minutes = Math.max(1, Math.round((unique * avgDelay) / 60));
  const days = cfg ? Math.ceil(unique / cfg.perDay) : 1;
  const valid =
    !!active &&
    name.trim().length > 0 &&
    message.trim().length >= 5 &&
    problems.length === 0 &&
    unique > 0 &&
    unique <= max &&
    invalid === 0 &&
    consent;

  /** Menghapus penerima yang nomornya ada di himpunan ini, dari kolom ketik maupun kontak terpilih. */
  const removeNumbers = (drop: Set<string>) => {
    const dropped = (phone: string) => drop.has(normalizePhone(phone) ?? '');
    setList((cur) =>
      cur
        .split('\n')
        .filter((line) => {
          const r = parseRecipients(line).ok[0];
          return !(r && dropped(r.phone));
        })
        .join('\n'),
    );
    setPicked((cur) =>
      Object.fromEntries(Object.entries(cur).filter(([, c]) => !dropped(c.phone))),
    );
  };

  const submit = () => {
    if (!valid || !active) return;
    create.mutate(
      {
        sessionId: active,
        name: name.trim(),
        message: message.trim(),
        recipients: withVars,
        ...(attachment ? { attachmentId: attachment.id } : {}),
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
              {problems.length > 0 ? (
                <ul className="space-y-0.5 text-xs text-destructive" role="alert">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {'{{nama}}'} diganti nama penerima (atau &quot;kak&quot; bila tidak ada).
                  {varNames.length > 0 && (
                    <> Dari file: {varNames.map((v) => `{{${v}}}`).join(', ')}.</>
                  )}{' '}
                  Contoh:{' '}
                  <span className="text-foreground">
                    {renderBroadcastMessage(message || '…', withVars[0]?.name, withVars[0]?.vars)}
                  </span>
                </p>
              )}
            </div>
            <AttachmentPicker attachment={attachment} onChange={setAttachment} />
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
            <RecipientFileImport
              onImport={(r) => {
                setList((cur) => [cur.trim(), ...toLines(r.recipients)].filter(Boolean).join('\n'));
                setFileVars((cur) => ({
                  ...cur,
                  ...Object.fromEntries(
                    r.recipients
                      .filter((x) => x.vars)
                      .map((x) => [normalizePhone(x.phone) ?? x.phone, x.vars as BroadcastVars]),
                  ),
                }));
                setVarNames((cur) => [...new Set([...cur, ...r.variables])]);
              }}
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
            {unique > 0 && (
              <NumberCheck sessionId={active} phones={phones} onRemove={removeNumbers} />
            )}
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
              {r.status === 'SENT' ? formatDateTime(r.sentAt) : broadcastReasonText(r.reason)}
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
      {b.attachment && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5 shrink-0" />
          <span className="truncate">{b.attachment.filename}</span>
          <span className="shrink-0">({formatSize(b.attachment.size)})</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Users /> {open ? 'Sembunyikan penerima' : 'Lihat penerima'}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={downloadUrl(`/whatsapp/broadcasts/${b.id}/export`, {})} download>
            <Download /> Unduh laporan (CSV)
          </a>
        </Button>
      </div>
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
