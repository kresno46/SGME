'use client';

import {
  CONTACT_CHANNEL_LABELS,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVELS,
  MAX_UNANSWERED_MESSAGES,
  OUTCOME_LABELS,
  type InterestLevel,
  type TaskActionInput,
} from '@smge/shared';
import type { OutreachTaskDto } from '@smge/types';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquareReply,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/common';
import { InterestBadge, LeadStatusBadge, TaskStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
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
import {
  Badge,
  Checkbox,
  Input,
  Label,
  Separator,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { formatDateTime, fromDateTimeLocal } from '@/lib/utils';
import { useTask, useTaskAction, useUpdateDraft } from './api';

type Panel =
  'reject' | 'mark_sent' | 'log_reply' | 'schedule_follow_up' | 'complete' | 'cancel' | null;

export function TaskDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {taskId && <TaskBody key={taskId} taskId={taskId} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskBody({ taskId }: { taskId: string }) {
  const q = useTask(taskId);
  const act = useTaskAction(taskId);
  const saveDraft = useUpdateDraft(taskId);
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Memuat tugas…</DialogTitle>
        </DialogHeader>
        <Skeleton className="h-40" />
      </>
    );
  }
  if (q.isError) {
    return (
      <DialogHeader>
        <DialogTitle>Tugas tidak dapat dimuat</DialogTitle>
        <DialogDescription>{q.error.message}</DialogDescription>
      </DialogHeader>
    );
  }
  const t = q.data;
  const can = (a: string) => t.allowedActions.includes(a);
  const editable = can('edit_draft');
  const currentDraft = draft ?? t.draftMessage ?? '';
  const dirty = draft !== null && draft !== (t.draftMessage ?? '');
  const messageToSend =
    t.status === 'FOLLOW_UP' ? t.draftMessage : (t.finalMessage ?? t.draftMessage);

  const run = async (body: TaskActionInput, success: string) => {
    setError(null);
    try {
      if (dirty) await saveDraft.mutateAsync(currentDraft);
      await act.mutateAsync(body);
      setDraft(null);
      setPanel(null);
      toast.success(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal');
    }
  };
  const busy = act.isPending || saveDraft.isPending;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {t.lead.name ?? 'Prospek tanpa nama'} <TaskStatusBadge status={t.status} />
        </DialogTitle>
        <DialogDescription>
          via @{t.account.username} · {CONTACT_CHANNEL_LABELS[t.channel]}
          {t.campaign && ` · ${t.campaign.name}`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <LeadStatusBadge status={t.lead.status} />
        <InterestBadge level={t.lead.interestLevel} />
        {t.lead.consentChannels.length > 0 && (
          <Badge variant="success">
            <ShieldCheck /> Izin:{' '}
            {t.lead.consentChannels.map((c) => CONTACT_CHANNEL_LABELS[c]).join(', ')}
          </Badge>
        )}
        <Link href={`/leads/${t.lead.id}`} className="ml-auto text-primary hover:underline">
          Profil prospek →
        </Link>
      </div>

      <FormError message={error} />
      {t.reviewNote && t.status === 'DRAFT' && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <strong>Catatan reviewer:</strong> {t.reviewNote}
        </div>
      )}

      {/* Pesan */}
      <div className="grid gap-1.5">
        <Label htmlFor="msg">{t.status === 'FOLLOW_UP' ? 'Pesan follow-up' : 'Pesan'}</Label>
        {editable ? (
          <>
            <Textarea
              id="msg"
              rows={5}
              value={currentDraft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{currentDraft.length}/2000 karakter</span>
              {dirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    saveDraft.mutate(currentDraft, {
                      onSuccess: () => {
                        setDraft(null);
                        toast.success('Draft disimpan');
                      },
                      onError: (e) => setError(e.message),
                    })
                  }
                >
                  Simpan draft
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
            {messageToSend || <span className="text-muted-foreground">Belum ada pesan</span>}
          </p>
        )}
      </div>

      {t.responseSummary && (
        <div className="rounded-md border p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Balasan prospek · {formatDateTime(t.repliedAt)}
          </p>
          <p className="mt-1">{t.responseSummary}</p>
        </div>
      )}

      <Timeline t={t} />
      <Separator />

      {/* Aksi utama */}
      {panel === null && (
        <div className="flex flex-wrap gap-2">
          {can('submit') && (
            <Button
              disabled={busy || !currentDraft.trim()}
              onClick={() => void run({ action: 'submit' }, 'Diajukan untuk review')}
            >
              <Send /> Ajukan review
            </Button>
          )}
          {can('approve') && (
            <Button
              disabled={busy}
              onClick={() => void run({ action: 'approve' }, 'Pesan disetujui')}
            >
              <ThumbsUp /> Setujui
            </Button>
          )}
          {can('reject') && (
            <Button variant="outline" onClick={() => setPanel('reject')}>
              <ThumbsDown /> Kembalikan ke draft
            </Button>
          )}
          {can('mark_sent') && (
            <Button onClick={() => setPanel('mark_sent')}>
              <Send /> {t.status === 'FOLLOW_UP' ? 'Kirim follow-up' : 'Kirim pesan'}
            </Button>
          )}
          {can('log_reply') && (
            <Button variant="outline" onClick={() => setPanel('log_reply')}>
              <MessageSquareReply /> Catat balasan
            </Button>
          )}
          {can('schedule_follow_up') && (
            <Button variant="outline" onClick={() => setPanel('schedule_follow_up')}>
              Jadwalkan follow-up
            </Button>
          )}
          {can('complete') && (
            <Button variant="outline" onClick={() => setPanel('complete')}>
              <CheckCircle2 /> Selesaikan
            </Button>
          )}
          {can('reopen') && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run({ action: 'reopen' }, 'Dikembalikan ke draft')}
            >
              <Undo2 /> Ubah pesan
            </Button>
          )}
          {can('cancel') && (
            <Button variant="ghost" className="text-destructive" onClick={() => setPanel('cancel')}>
              <XCircle /> Batalkan
            </Button>
          )}
          {t.allowedActions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t.status === 'WAITING_REVIEW'
                ? 'Menunggu review oleh Admin.'
                : t.status === 'COMPLETED' || t.status === 'CANCELLED'
                  ? 'Tugas sudah ditutup.'
                  : 'Tidak ada aksi yang tersedia untuk Anda.'}
            </p>
          )}
        </div>
      )}

      {panel === 'reject' && (
        <ReasonPanel
          label="Catatan untuk operator"
          confirm="Kembalikan ke draft"
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(reviewNote) =>
            run({ action: 'reject', reviewNote }, 'Dikembalikan ke operator')
          }
        />
      )}
      {panel === 'cancel' && (
        <ReasonPanel
          label="Alasan pembatalan"
          confirm="Batalkan tugas"
          destructive
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(reason) => run({ action: 'cancel', reason }, 'Tugas dibatalkan')}
        />
      )}
      {panel === 'mark_sent' && (
        <SendPanel
          t={t}
          message={messageToSend ?? ''}
          busy={busy}
          onCancel={() => setPanel(null)}
          onConfirm={() => run({ action: 'mark_sent', confirmed: true }, 'Pengiriman dicatat')}
        />
      )}
      {panel === 'log_reply' && (
        <ReplyPanel
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(b) => run(b, 'Balasan dicatat')}
        />
      )}
      {panel === 'schedule_follow_up' && (
        <FollowUpPanel
          t={t}
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(b) => run(b, 'Follow-up dijadwalkan')}
        />
      )}
      {panel === 'complete' && (
        <CompletePanel
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(b) => run(b, 'Tugas selesai')}
        />
      )}
    </>
  );
}

function Timeline({ t }: { t: OutreachTaskDto }) {
  const rows = [
    ['Dibuat', t.createdAt],
    ['Diajukan', t.submittedAt],
    ['Disetujui', t.approvedAt, t.reviewer?.name],
    ['Terkirim pertama', t.sentConfirmedAt],
    ['Terkirim terakhir', t.sentCount > 1 ? t.lastSentAt : null],
    ['Dibalas', t.repliedAt],
    ['Follow-up', t.followUpAt],
    ['Selesai', t.completedAt],
  ].filter(([, v]) => v) as [string, string, string | undefined][];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
      {rows.map(([label, at, by]) => (
        <div key={label}>
          <dt className="font-medium text-foreground">{label}</dt>
          <dd>
            {formatDateTime(at)}
            {by && ` · ${by}`}
          </dd>
        </div>
      ))}
      {t.outcome && (
        <div>
          <dt className="font-medium text-foreground">Hasil</dt>
          <dd>{OUTCOME_LABELS[t.outcome as keyof typeof OUTCOME_LABELS] ?? t.outcome}</dd>
        </div>
      )}
      {t.cancelReason && (
        <div className="col-span-2">
          <dt className="font-medium text-foreground">Alasan batal</dt>
          <dd>{t.cancelReason}</dd>
        </div>
      )}
    </dl>
  );
}

function PanelShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
      {children}
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={onCancel}>
        Kembali
      </Button>
    </div>
  );
}

function ReasonPanel({
  label,
  confirm,
  destructive,
  busy,
  onCancel,
  onSubmit,
}: {
  label: string;
  confirm: string;
  destructive?: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState('');
  return (
    <PanelShell onCancel={onCancel}>
      <FormField label={label} htmlFor="reason-panel">
        <Input id="reason-panel" autoFocus value={v} onChange={(e) => setV(e.target.value)} />
      </FormField>
      <Button
        variant={destructive ? 'destructive' : 'default'}
        disabled={busy || v.trim().length < 3}
        onClick={() => onSubmit(v.trim())}
      >
        {busy && <Loader2 className="animate-spin" />}
        {confirm}
      </Button>
    </PanelShell>
  );
}

/** Pengiriman tetap dilakukan manusia di aplikasi TikTok; sistem hanya mencatat setelah dikonfirmasi. */
function SendPanel({
  t,
  message,
  busy,
  onCancel,
  onConfirm,
}: {
  t: OutreachTaskDto;
  message: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const profile =
    t.channel === 'TIKTOK_DM' && t.lead.tiktokUsername
      ? `https://www.tiktok.com/@${t.lead.tiktokUsername}`
      : null;
  const target =
    t.channel === 'EMAIL'
      ? t.lead.email
      : t.channel === 'TIKTOK_DM'
        ? `@${t.lead.tiktokUsername}`
        : t.lead.phone;
  return (
    <PanelShell onCancel={onCancel}>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>
          Salin pesan, lalu buka {CONTACT_CHANNEL_LABELS[t.channel]} dari akun @{t.account.username}
          .
        </li>
        <li>
          Kirim secara manual ke <strong>{target}</strong>. Sesuaikan bila perlu agar tetap
          personal.
        </li>
        <li>Kembali ke sini dan konfirmasi bahwa pesan benar-benar terkirim.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(message);
            toast.success('Pesan disalin');
          }}
        >
          <Copy /> Salin pesan
        </Button>
        {profile && (
          <Button variant="outline" size="sm" asChild>
            <a href={profile} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Buka profil TikTok
            </a>
          </Button>
        )}
      </div>
      <Label className="items-start gap-3 rounded-md border bg-card p-3 font-normal leading-snug">
        <Checkbox
          className="mt-0.5"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Saya sudah mengirim pesan ini secara manual dan pesan benar-benar terkirim.
      </Label>
      <Button disabled={busy || !confirmed} onClick={onConfirm}>
        {busy && <Loader2 className="animate-spin" />}
        Catat sebagai terkirim
      </Button>
    </PanelShell>
  );
}

function ReplyPanel({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (b: TaskActionInput) => void;
}) {
  const [summary, setSummary] = useState('');
  const [interest, setInterest] = useState<InterestLevel>('MEDIUM');
  const [optOut, setOptOut] = useState(false);
  return (
    <PanelShell onCancel={onCancel}>
      <FormField label="Ringkasan balasan" htmlFor="reply-sum">
        <Textarea
          id="reply-sum"
          rows={2}
          autoFocus
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </FormField>
      <FormField label="Tingkat ketertarikan">
        <Select value={interest} onValueChange={(v) => setInterest(v as InterestLevel)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTEREST_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {INTEREST_LEVEL_LABELS[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <Label className="font-normal">
        <Checkbox checked={optOut} onChange={(e) => setOptOut(e.target.checked)} />
        Prospek meminta tidak dihubungi lagi (tandai jangan dihubungi)
      </Label>
      <Button
        variant={optOut ? 'destructive' : 'default'}
        disabled={busy || summary.trim().length < 3}
        onClick={() =>
          onSubmit({
            action: 'log_reply',
            responseSummary: summary.trim(),
            interestLevel: interest,
            optOut,
          })
        }
      >
        {busy && <Loader2 className="animate-spin" />}
        Simpan balasan
      </Button>
    </PanelShell>
  );
}

function FollowUpPanel({
  t,
  busy,
  onCancel,
  onSubmit,
}: {
  t: OutreachTaskDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (b: TaskActionInput) => void;
}) {
  const [at, setAt] = useState('');
  const [message, setMessage] = useState('');
  const replied = !!t.repliedAt;
  const consent = t.lead.consentChannels.includes(t.channel);
  return (
    <PanelShell onCancel={onCancel}>
      {!replied && (
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          Prospek belum membalas. Follow-up hanya boleh bila prospek memberi izin komunikasi untuk
          kanal ini
          {consent ? ' (izin tersedia)' : ' — izin belum ada, sehingga follow-up akan ditolak'}, dan
          maksimal {MAX_UNANSWERED_MESSAGES} pesan tanpa balasan.
        </p>
      )}
      <FormField label="Jadwal follow-up" htmlFor="fu-at">
        <Input
          id="fu-at"
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </FormField>
      <FormField label="Draft pesan follow-up (opsional)" htmlFor="fu-msg">
        <Textarea
          id="fu-msg"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </FormField>
      <Button
        disabled={busy || !at}
        onClick={() =>
          onSubmit({
            action: 'schedule_follow_up',
            followUpAt: fromDateTimeLocal(at),
            ...(message.trim() ? { draftMessage: message.trim() } : {}),
          })
        }
      >
        {busy && <Loader2 className="animate-spin" />}
        Jadwalkan
      </Button>
    </PanelShell>
  );
}

function CompletePanel({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (b: TaskActionInput) => void;
}) {
  const [outcome, setOutcome] = useState<keyof typeof OUTCOME_LABELS>('INTERESTED');
  const [note, setNote] = useState('');
  return (
    <PanelShell onCancel={onCancel}>
      <FormField
        label="Hasil"
        hint={
          outcome === 'REGISTERED'
            ? 'Registrasi dikonfirmasi operator; verifikasi otomatis tersedia di Fase 5.'
            : undefined
        }
      >
        <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[]).map((o) => (
              <SelectItem key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Catatan (opsional)" htmlFor="done-note">
        <Input id="done-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>
      <Button
        disabled={busy}
        onClick={() => onSubmit({ action: 'complete', outcome, note: note.trim() || null })}
      >
        {busy && <Loader2 className="animate-spin" />}
        Selesaikan tugas
      </Button>
    </PanelShell>
  );
}
