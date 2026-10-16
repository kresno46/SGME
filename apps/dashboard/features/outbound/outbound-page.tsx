'use client';

import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  PERMISSIONS,
  type ContactChannel,
  type OutreachTaskStatus,
} from '@smge/shared';
import type { OutboundQueueItemDto } from '@smge/types';
import {
  CalendarClock,
  ClipboardCheck,
  FileText,
  Info,
  ListTodo,
  Loader2,
  MessageSquareReply,
  Plus,
  Search,
  Smartphone,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  EmptyState,
  FormError,
  FormField,
  PageHeader,
  Pagination,
  StatCard,
  TableSkeleton,
} from '@/components/common';
import { InterestBadge, LeadStatusBadge, TaskStatusBadge } from '@/components/status-badges';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useAccountOptions, useCampaignOptions } from '@/hooks/use-lookups';
import { formatNumber, formatRelative } from '@/lib/utils';
import { leadContact } from '../leads/leads-page';
import { useCreateTask, useOutboundSummary, useQueue, useTasks, useTemplates } from './api';
import { TaskDialog } from './task-dialog';
import { TemplatesTab } from './templates-tab';

const TASK_GROUPS: { value: string; label: string; statuses: OutreachTaskStatus[] }[] = [
  { value: 'action', label: 'Perlu tindakan', statuses: ['DRAFT', 'APPROVED', 'FOLLOW_UP'] },
  { value: 'review', label: 'Menunggu review', statuses: ['WAITING_REVIEW'] },
  { value: 'sent', label: 'Menunggu balasan', statuses: ['MANUALLY_SENT'] },
  { value: 'replied', label: 'Dibalas', statuses: ['REPLIED'] },
  { value: 'closed', label: 'Ditutup', statuses: ['COMPLETED', 'CANCELLED'] },
];

export function OutboundPage() {
  const router = useRouter();
  const params = useSearchParams();
  const accounts = useAccountOptions('OUTBOUND');
  const accountId =
    params.get('account') ??
    accounts.data?.find((a) => a.status === 'ACTIVE')?.id ??
    accounts.data?.[0]?.id ??
    null;
  const tab = params.get('tab') ?? 'queue';
  const taskId = params.get('task');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'account') next.delete('task');
    router.replace(`/outbound?${next.toString()}`, { scroll: false });
  };

  const account = accounts.data?.find((a) => a.id === accountId);

  return (
    <>
      <PageHeader
        title="Outbound Workstation"
        description="Penjangkauan personal Jalur B: antrean prospek → draft → review → kirim manual → catat hasil."
        actions={
          accounts.data && accounts.data.length > 0 ? (
            <Select value={accountId ?? undefined} onValueChange={(v) => setParam('account', v)}>
              <SelectTrigger className="w-64" aria-label="Pilih akun TikTok">
                <Smartphone className="size-4 text-muted-foreground" />
                <SelectValue placeholder="Pilih akun" />
              </SelectTrigger>
              <SelectContent>
                {accounts.data.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    @{a.username} {a.status !== 'ACTIVE' && '(tidak aktif)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {accounts.isPending ? (
        <TableSkeleton />
      ) : !accounts.data?.length ? (
        <Card>
          <EmptyState
            icon={Smartphone}
            title="Belum ada akun Jalur B"
            description="Tambahkan akun TikTok dengan jalur Outbound terlebih dahulu."
            action={
              <Button asChild>
                <Link href="/accounts">Kelola akun TikTok</Link>
              </Button>
            }
          />
        </Card>
      ) : accountId ? (
        <>
          {account && account.status !== 'ACTIVE' && (
            <div className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              Akun @{account.username} sedang tidak aktif. Tugas baru tidak dapat dibuat sampai
              statusnya Aktif.
            </div>
          )}
          <Summary accountId={accountId} />
          <Tabs value={tab} onValueChange={(v) => setParam('tab', v)} className="mt-6">
            <TabsList>
              <TabsTrigger value="queue">
                <Users /> Antrean prospek
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListTodo /> Tugas
              </TabsTrigger>
              <TabsTrigger value="templates">
                <FileText /> Template
              </TabsTrigger>
            </TabsList>
            <TabsContent value="queue">
              <Queue
                accountId={accountId}
                onTaskCreated={(id) => {
                  const next = new URLSearchParams(params.toString());
                  next.set('tab', 'tasks');
                  next.set('task', id);
                  router.replace(`/outbound?${next.toString()}`, { scroll: false });
                }}
              />
            </TabsContent>
            <TabsContent value="tasks">
              <Tasks accountId={accountId} onOpen={(id) => setParam('task', id)} />
            </TabsContent>
            <TabsContent value="templates">
              <TemplatesTab />
            </TabsContent>
          </Tabs>
          <TaskDialog taskId={taskId} onClose={() => setParam('task', null)} />
        </>
      ) : null}
    </>
  );
}

function Summary({ accountId }: { accountId: string }) {
  const q = useOutboundSummary(accountId);
  const s = q.data;
  const loading = q.isPending;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Tugas baru hari ini"
        icon={Plus}
        loading={loading}
        value={s ? `${formatNumber(s.createdToday)} / ${formatNumber(s.dailyLimit)}` : '—'}
        hint="Batas harian menjaga penjangkauan tetap personal"
      />
      <StatCard
        label="Follow-up jatuh tempo"
        icon={CalendarClock}
        loading={loading}
        value={formatNumber(s?.followUpsDue ?? 0)}
      />
      <StatCard
        label="Menunggu review"
        icon={ClipboardCheck}
        loading={loading}
        value={formatNumber(s?.byStatus.WAITING_REVIEW ?? 0)}
      />
      <StatCard
        label="Tingkat balasan (7 hari)"
        icon={MessageSquareReply}
        loading={loading}
        value={s?.replyRate == null ? '—' : `${s.replyRate.toLocaleString('id-ID')}%`}
        hint={
          s && (
            <span>
              {formatNumber(s.repliesLast7Days)} balasan dari {formatNumber(s.sentLast7Days)} pesan
            </span>
          )
        }
      />
    </div>
  );
}

function Queue({
  accountId,
  onTaskCreated,
}: {
  accountId: string;
  onTaskCreated: (id: string) => void;
}) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<ContactChannel>('TIKTOK_DM');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<OutboundQueueItemDto | null>(null);
  const q = useQueue({ accountId, page, search: useDebounce(search) || undefined, channel });

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari nama, @username, atau tag…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari antrean"
          />
        </div>
        <Select
          value={channel}
          onValueChange={(v) => {
            setChannel(v as ContactChannel);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48" aria-label="Kanal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CONTACT_CHANNEL_LABELS[c]}
                {c !== 'TIKTOK_DM' && ' (perlu izin)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="flex items-start gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Hanya prospek yang memenuhi syarat: bukan daftar larangan, belum terdaftar, tanpa tugas
        berjalan, memiliki kontak untuk kanal ini
        {channel !== 'TIKTOK_DM' && ', dan sudah memberi izin komunikasi'}.
      </p>
      {q.isPending ? (
        <TableSkeleton cols={5} />
      ) : q.isError ? (
        <EmptyState title="Gagal memuat antrean" description={q.error.message} />
      ) : !q.data.items.length ? (
        <EmptyState
          icon={Users}
          title="Antrean kosong"
          description="Tidak ada prospek yang memenuhi syarat untuk akun & kanal ini."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Prospek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ketertarikan</TableHead>
                <TableHead>Prioritas</TableHead>
                <TableHead>Kontak terakhir</TableHead>
                <TableHead className="w-32">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((item) => (
                <TableRow key={item.lead.id}>
                  <TableCell>
                    <Link href={`/leads/${item.lead.id}`} className="font-medium hover:underline">
                      {item.lead.name ?? 'Tanpa nama'}
                    </Link>
                    <p className="max-w-60 truncate text-xs text-muted-foreground">
                      {leadContact(item.lead)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={item.lead.status} />
                  </TableCell>
                  <TableCell>
                    <InterestBadge level={item.lead.interestLevel} />
                  </TableCell>
                  <TableCell>
                    <Tooltip
                      content={
                        item.priority.reasons.length
                          ? item.priority.reasons.join(' · ')
                          : 'Tidak ada sinyal khusus'
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${item.priority.score}%` }}
                          />
                        </span>
                        <span className="text-sm tabular-nums">{item.priority.score}</span>
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(item.lead.lastContactedAt)}
                  </TableCell>
                  <TableCell>
                    {can(PERMISSIONS.OUTREACH_WORK) && (
                      <Button size="sm" onClick={() => setCreating(item)}>
                        <Plus /> Buat tugas
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={q.data.page}
            totalPages={q.data.totalPages}
            total={q.data.total}
            pageSize={q.data.pageSize}
            onPageChange={setPage}
          />
          {q.data.truncated && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Menampilkan 500 kandidat terbaru. Gunakan pencarian untuk mempersempit antrean.
            </p>
          )}
        </>
      )}
      <CreateTaskDialog
        item={creating}
        accountId={accountId}
        channel={channel}
        onClose={() => setCreating(null)}
        onCreated={(id) => {
          setCreating(null);
          onTaskCreated(id);
        }}
      />
    </Card>
  );
}

const NONE = '__none__';

function CreateTaskDialog({
  item,
  accountId,
  channel,
  onClose,
  onCreated,
}: {
  item: OutboundQueueItemDto | null;
  accountId: string;
  channel: ContactChannel;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat tugas untuk {item?.lead.name ?? 'prospek'}</DialogTitle>
          <DialogDescription>
            Draft pesan dibuat dari template dan masih bisa diubah sebelum diajukan untuk review.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <CreateTaskForm
            item={item}
            accountId={accountId}
            channel={channel}
            onCancel={onClose}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskForm({
  item,
  accountId,
  channel,
  onCancel,
  onCreated,
}: {
  item: OutboundQueueItemDto;
  accountId: string;
  channel: ContactChannel;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const templates = useTemplates(true);
  const campaigns = useCampaignOptions('OUTBOUND');
  const create = useCreateTask();
  const [templateId, setTemplateId] = useState(NONE);
  const [campaignId, setCampaignId] = useState(item.lead.sourceCampaign?.id ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const usable = (templates.data ?? []).filter((t) => t.lane !== 'OFFICIAL');

  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline">{CONTACT_CHANNEL_LABELS[channel]}</Badge>
        {item.priority.reasons.map((r) => (
          <Badge key={r} variant="secondary">
            {r}
          </Badge>
        ))}
      </div>
      <FormField label="Template">
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Tanpa template (tulis sendiri)</SelectItem>
            {usable.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {templateId !== NONE && (
        <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
          {usable.find((t) => t.id === templateId)?.content}
        </p>
      )}
      <FormField label="Campaign (opsional)">
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Tidak ada</SelectItem>
            {campaigns.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              {
                leadId: item.lead.id,
                tiktokAccountId: accountId,
                channel,
                templateId: templateId === NONE ? null : templateId,
                campaignId: campaignId === NONE ? null : campaignId,
              },
              {
                onSuccess: (task) => {
                  toast.success('Tugas dibuat');
                  onCreated(task.id);
                },
                onError: (e) => setError(e.message),
              },
            )
          }
        >
          {create.isPending && <Loader2 className="animate-spin" />}
          Buat draft
        </Button>
      </DialogFooter>
    </div>
  );
}

function Tasks({ accountId, onOpen }: { accountId: string; onOpen: (id: string) => void }) {
  const [group, setGroup] = useState('action');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const statuses = TASK_GROUPS.find((g) => g.value === group)!.statuses;
  const q = useTasks({
    accountId,
    status: statuses.join(','),
    operatorId: mine ? 'me' : undefined,
    page,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {TASK_GROUPS.map((g) => (
          <Button
            key={g.value}
            size="sm"
            variant={group === g.value ? 'secondary' : 'ghost'}
            onClick={() => {
              setGroup(g.value);
              setPage(1);
            }}
          >
            {g.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={mine ? 'secondary' : 'ghost'}
          className="ml-auto"
          onClick={() => setMine((m) => !m)}
        >
          Tugas saya
        </Button>
      </div>
      {q.isPending ? (
        <TableSkeleton cols={5} />
      ) : !q.data?.items.length ? (
        <EmptyState
          icon={ListTodo}
          title="Tidak ada tugas"
          description="Buat tugas dari tab Antrean prospek."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Prospek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pesan</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Jadwal / update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((t) => {
                const due =
                  t.status === 'FOLLOW_UP' && t.followUpAt && new Date(t.followUpAt) <= new Date();
                return (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
                    <TableCell>
                      <p className="font-medium">{t.lead.name ?? 'Tanpa nama'}</p>
                      <p className="text-xs text-muted-foreground">{leadContact(t.lead)}</p>
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={t.status} />
                      {t.sentCount > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.sentCount}× terkirim
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72">
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {t.finalMessage ?? t.draftMessage ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{t.operator?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {t.status === 'FOLLOW_UP' && t.followUpAt ? (
                        <span className={due ? 'font-medium text-destructive' : ''}>
                          <CalendarClock className="mr-1 inline size-3.5" />
                          {formatRelative(t.followUpAt)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{formatRelative(t.updatedAt)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination
            page={q.data.page}
            totalPages={q.data.totalPages}
            total={q.data.total}
            pageSize={q.data.pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  );
}
