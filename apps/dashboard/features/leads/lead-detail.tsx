'use client';

import {
  CONSENT_SOURCE_LABELS,
  CONSENT_SOURCES,
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  LEAD_ACTIVITY_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  PERMISSIONS,
  type ConsentSource,
  type ContactChannel,
  type LeadActivityType,
  type LeadStatus,
} from '@smge/shared';
import type { LeadDetailDto } from '@smge/types';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  ExternalLink,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Send,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, EmptyState, FormError, FormField } from '@/components/common';
import { InterestBadge, LeadStatusBadge, TaskStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { useInvalidateLeads, useLead, useLeadMutation } from './api';
import { LeadFormDialog } from './lead-form-dialog';

export function LeadDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const router = useRouter();
  const q = useLead(id);
  const invalidate = useInvalidateLeads();
  const [editOpen, setEditOpen] = useState(false);
  const [dncOpen, setDncOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState<ContactChannel | null>(null);

  const setStatus = useLeadMutation((status: LeadStatus) =>
    api.patch<LeadDetailDto>(`/leads/${id}`, { status }),
  );
  const unmarkDnc = useLeadMutation(() => api.delete<LeadDetailDto>(`/leads/${id}/do-not-contact`));

  if (q.isPending) return <Skeleton className="h-96 w-full" />;
  if (q.isError) {
    return (
      <EmptyState
        title="Prospek tidak dapat dimuat"
        description={q.error.message}
        action={
          <Button asChild variant="outline">
            <Link href="/leads">Kembali</Link>
          </Button>
        }
      />
    );
  }
  const l = q.data;
  const canManage = can(PERMISSIONS.LEADS_MANAGE) && !l.doNotContact;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/leads">
          <ArrowLeft /> Semua prospek
        </Link>
      </Button>

      {l.doNotContact && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm sm:flex-row sm:items-center">
          <Ban className="size-5 shrink-0 text-destructive" />
          <p className="flex-1">
            <strong>Jangan dihubungi.</strong> Prospek ini ada di daftar larangan kontak dan
            dikecualikan dari semua penjangkauan.
          </p>
          {can(PERMISSIONS.DNC_MANAGE) && (
            <Button
              size="sm"
              variant="outline"
              disabled={unmarkDnc.isPending}
              onClick={() => unmarkDnc.mutate(undefined)}
            >
              <Undo2 /> Cabut larangan
            </Button>
          )}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{l.name ?? 'Prospek tanpa nama'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <LeadStatusBadge status={l.status} />
            <InterestBadge level={l.interestLevel} />
            {l.tags.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Select value={l.status} onValueChange={(v) => setStatus.mutate(v as LeadStatus)}>
              <SelectTrigger className="w-48" aria-label="Ubah status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.filter((s) => s !== 'DO_NOT_CONTACT').map((s) => (
                  <SelectItem key={s} value={s}>
                    {LEAD_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Aksi lain">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/outbound">
                    <Send /> Buka Outbound Workstation
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDncOpen(true)}>
                  <Ban /> Jangan hubungi
                </DropdownMenuItem>
                {can(PERMISSIONS.LEADS_DELETE) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      <Trash2 /> Hapus data pribadi
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Informasi</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">TikTok</dt>
                <dd>
                  {l.tiktokUsername ? (
                    <a
                      href={`https://www.tiktok.com/@${l.tiktokUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      @{l.tiktokUsername} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{l.email ?? '—'}</dd>
                <dt className="text-muted-foreground">Telepon</dt>
                <dd>{l.phone ?? '—'}</dd>
                <dt className="text-muted-foreground">Sumber</dt>
                <dd>
                  {LEAD_SOURCE_LABELS[l.source]}
                  {l.sourceAccount && ` · @${l.sourceAccount.username}`}
                </dd>
                <dt className="text-muted-foreground">Campaign</dt>
                <dd>
                  {l.sourceCampaign ? (
                    <Link
                      href={`/campaigns/${l.sourceCampaign.id}`}
                      className="text-primary hover:underline"
                    >
                      {l.sourceCampaign.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-muted-foreground">Operator</dt>
                <dd>{l.operator?.name ?? 'Belum ditugaskan'}</dd>
                <dt className="text-muted-foreground">Follow-up</dt>
                <dd>{l.nextFollowUpAt ? formatDateTime(l.nextFollowUpAt) : '—'}</dd>
                <dt className="text-muted-foreground">Terdaftar</dt>
                <dd>{l.registeredAt ? formatDateTime(l.registeredAt) : '—'}</dd>
                <dt className="text-muted-foreground">Ditambahkan</dt>
                <dd>{formatDateTime(l.createdAt)}</dd>
              </dl>
              {l.notes && (
                <p className="mt-4 rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                  {l.notes}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Izin komunikasi</CardTitle>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
                  <ShieldCheck /> Catat izin
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {l.consents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada izin tercatat. Tanpa izin, hanya DM TikTok manual yang diperbolehkan dan
                  follow-up tanpa balasan tidak dapat dijadwalkan.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {l.consents.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start gap-3 rounded-md border p-2.5 text-sm"
                    >
                      {c.status === 'GRANTED' ? (
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {CONTACT_CHANNEL_LABELS[c.channel]}{' '}
                          <span className="font-normal text-muted-foreground">
                            · {c.status === 'GRANTED' ? 'diizinkan' : 'dicabut'}{' '}
                            {formatRelative(c.status === 'GRANTED' ? c.grantedAt : c.withdrawnAt)}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {CONSENT_SOURCE_LABELS[c.source as ConsentSource] ?? c.source}
                          {c.evidence && ` — ${c.evidence}`}
                          {c.recordedBy && ` (dicatat ${c.recordedBy.name})`}
                        </p>
                      </div>
                      {canManage && c.status === 'GRANTED' && (
                        <Button size="sm" variant="ghost" onClick={() => setWithdrawing(c.channel)}>
                          Cabut
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tugas outbound</CardTitle>
            </CardHeader>
            <CardContent>
              {l.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada tugas penjangkauan.</p>
              ) : (
                <ul className="grid gap-2">
                  {l.tasks.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/outbound?account=${t.account.id}&task=${t.id}`}
                        className="flex items-center gap-2 rounded-md border p-2.5 text-sm hover:bg-muted/50"
                      >
                        <TaskStatusBadge status={t.status} />
                        <span className="flex-1 truncate">via @{t.account.username}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelative(t.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Timeline lead={l} canNote={can(PERMISSIONS.LEADS_MANAGE)} />
      </div>

      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={l} />
      <ReasonDialog
        open={dncOpen}
        onOpenChange={setDncOpen}
        title="Tandai jangan dihubungi?"
        description="Semua izin dicabut, tugas outbound yang belum terkirim dibatalkan, dan kontak dicatat di daftar larangan."
        confirmLabel="Tandai jangan dihubungi"
        onConfirm={async (reason) => {
          await api.post(`/leads/${id}/do-not-contact`, { reason });
          toast.success('Prospek ditandai jangan dihubungi');
          await invalidate();
        }}
      />
      <ConsentDialog leadId={id} open={consentOpen} onOpenChange={setConsentOpen} />
      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Cabut izin komunikasi?"
        description={`Izin ${withdrawing ? CONTACT_CHANNEL_LABELS[withdrawing] : ''} dicabut dan tugas pada kanal ini yang belum terkirim dibatalkan.`}
        confirmLabel="Cabut izin"
        destructive
        onConfirm={async () => {
          await api.post(`/leads/${id}/consents/withdraw`, { channel: withdrawing });
          toast.success('Izin dicabut');
          await invalidate();
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title="Hapus data pribadi prospek?"
        description="Nama, kontak, catatan, izin, dan riwayat aktivitas dihapus permanen. Statistik agregat tetap tersimpan tanpa identitas. Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Hapus permanen"
        onConfirm={async () => {
          await api.delete(`/leads/${id}`);
          toast.success('Data pribadi prospek dihapus');
          await invalidate();
          router.replace('/leads');
        }}
      />
    </>
  );
}

const ACTIVITY_ICON: Partial<Record<LeadActivityType, typeof Send>> = {
  MESSAGE_SENT: Send,
  MESSAGE_RECEIVED: MessageSquareText,
  CONSENT_CHANGE: ShieldCheck,
  FOLLOW_UP_SCHEDULED: CalendarClock,
};

function Timeline({ lead, canNote }: { lead: LeadDetailDto; canNote: boolean }) {
  const [note, setNote] = useState('');
  const addNote = useLeadMutation((text: string) =>
    api.post<LeadDetailDto>(`/leads/${lead.id}/notes`, { note: text }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat aktivitas</CardTitle>
      </CardHeader>
      <CardContent>
        {canNote && (
          <form
            className="mb-5 grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              addNote.mutate(note, { onSuccess: () => setNote('') });
            }}
          >
            <Textarea
              rows={2}
              placeholder="Tulis catatan…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Catatan baru"
            />
            <div>
              <Button size="sm" type="submit" disabled={addNote.isPending || !note.trim()}>
                {addNote.isPending && <Loader2 className="animate-spin" />}
                Simpan catatan
              </Button>
            </div>
          </form>
        )}
        {lead.activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
        ) : (
          <ol className="relative grid gap-4 border-l pl-5">
            {lead.activities.map((a) => {
              const Icon = ACTIVITY_ICON[a.type as LeadActivityType];
              const message = (a.metadata as { message?: string } | null)?.message;
              return (
                <li key={a.id} className="relative">
                  <span className="absolute top-1 -left-[1.6rem] flex size-3 items-center justify-center rounded-full border-2 border-card bg-primary" />
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {Icon && <Icon className="size-3" />}
                    {LEAD_ACTIVITY_TYPE_LABELS[a.type as LeadActivityType] ?? a.type} ·{' '}
                    {formatDateTime(a.createdAt)}
                    {a.actor && ` · ${a.actor.name}`}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{a.summary}</p>
                  {message && (
                    <blockquote className="mt-1 border-l-2 pl-3 text-sm text-muted-foreground italic">
                      {message}
                    </blockquote>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ReasonForm
          confirmLabel={confirmLabel}
          onConfirm={onConfirm}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  onConfirm,
  onDone,
}: {
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<void>;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <FormField label="Alasan" htmlFor="reason">
        <Input id="reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button
          variant="destructive"
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm(reason.trim());
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Gagal');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConsentDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat izin komunikasi</DialogTitle>
          <DialogDescription>
            Catat hanya bila prospek benar-benar menyetujui dihubungi lewat kanal ini. Mengikuti
            akun TikTok tidak termasuk persetujuan.
          </DialogDescription>
        </DialogHeader>
        <ConsentForm leadId={leadId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConsentForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const [channel, setChannel] = useState<ContactChannel>('WHATSAPP');
  const [source, setSource] = useState<ConsentSource>('CONVERSATION');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const grant = useLeadMutation(() =>
    api.post<LeadDetailDto>(`/leads/${leadId}/consents`, { channel, source, evidence }),
  );
  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Kanal">
          <Select value={channel} onValueChange={(v) => setChannel(v as ContactChannel)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONTACT_CHANNEL_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Sumber izin">
          <Select value={source} onValueChange={(v) => setSource(v as ConsentSource)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONSENT_SOURCES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CONSENT_SOURCE_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <FormField
        label="Bukti persetujuan"
        htmlFor="evidence"
        hint='Contoh: "Membalas DM 15/10: boleh kirim info lewat WA"'
      >
        <Textarea
          id="evidence"
          rows={2}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button
          disabled={grant.isPending || evidence.trim().length < 5}
          onClick={() =>
            grant.mutate(undefined, {
              onSuccess: () => {
                toast.success('Izin dicatat');
                onDone();
              },
              onError: (e) => setError(e.message),
            })
          }
        >
          {grant.isPending && <Loader2 className="animate-spin" />}
          Simpan izin
        </Button>
      </DialogFooter>
    </div>
  );
}
