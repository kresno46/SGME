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
  ExternalLink,
  Info,
  ListTodo,
  Loader2,
  MessageSquareReply,
  Plus,
  Search,
  Send,
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
import { formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import { HIDE_OFFICIAL_LANE } from '@/lib/marketing-scope';
import { leadContact } from '../leads/leads-page';
import { useCreateTask, useOutboundSummary, useQueue, useTasks, useTemplates } from './api';
import { TaskDialog } from './task-dialog';
import { BulkDmDialog } from './bulk-dm-dialog';
import { FollowersDialog } from './followers-dialog';
import { BrowserDmPanel } from './browser-dm-panel';
import { TemplatesTab } from './templates-tab';

const TASK_GROUPS: { value: string; label: string; statuses: OutreachTaskStatus[] }[] = [
  { value: 'action', label: 'Perlu tindakan', statuses: ['DRAFT', 'APPROVED', 'FOLLOW_UP'] },
  { value: 'review', label: 'Belum diantrekan', statuses: ['WAITING_REVIEW'] },
  { value: 'sent', label: 'Menunggu balasan', statuses: ['MANUALLY_SENT', 'BROWSER_SENT'] },
  { value: 'replied', label: 'Dibalas', statuses: ['REPLIED'] },
  { value: 'closed', label: 'Ditutup', statuses: ['COMPLETED', 'CANCELLED'] },
];

export function OutboundPage() {
  const { can, user } = useAuth();
  const simple = user.role === 'MARKETING_OPERATOR';
  const [bulkOpen, setBulkOpen] = useState(false);
  const [initialLeadIds, setInitialLeadIds] = useState<string[] | undefined>();
  const [followersOpen, setFollowersOpen] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const accounts = useAccountOptions('OUTBOUND');
  const accountId =
    params.get('account') ??
    accounts.data?.find((a) => a.status === 'ACTIVE')?.id ??
    accounts.data?.[0]?.id ??
    null;
  const requestedTab = params.get('tab');
  const tab = requestedTab ?? 'queue';
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
        title={simple ? 'Kirim DM TikTok' : 'Outbound Workstation'}
        description={
          simple
            ? 'Ambil followers, pilih pesan, lalu kirim DM.'
            : 'Pilih penerima dan pesan, tinjau, lalu mulai pengiriman melalui browser.'
        }
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
                    {user.role === 'SUPER_ADMIN' && ` · ${a.owner?.name ?? 'Belum ditetapkan'}`}
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
            title="Belum ada akun pengirim"
            description="Tambahkan akun TikTok untuk mengambil followers dan mengirim DM."
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
          <Summary accountId={accountId} simple={simple} />
          {can(PERMISSIONS.OUTREACH_WORK) && account && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  if (!params.get('account')) setParam('account', account.id);
                  setInitialLeadIds(undefined);
                  setBulkOpen(true);
                }}
              >
                <Send /> Kirim DM
              </Button>
              {can(PERMISSIONS.LEADS_IMPORT) && (
                <Button variant="outline" onClick={() => setFollowersOpen(true)}>
                  <Users /> Ambil followers
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Penerima → pesan → tinjau → mulai extension.
              </p>
            </div>
          )}
          {bulkOpen && account && (
            <BulkDmDialog
              key={accountId}
              account={account}
              initialLeadIds={initialLeadIds}
              compact={!!initialLeadIds?.length}
              onClose={() => setBulkOpen(false)}
            />
          )}
          {followersOpen && account && can(PERMISSIONS.LEADS_IMPORT) && (
            <FollowersDialog
              key={accountId}
              account={account}
              onClose={() => setFollowersOpen(false)}
            />
          )}
          {can(PERMISSIONS.OUTREACH_WORK) && (
            <BrowserDmPanel key={`sender-${accountId}`} accountId={accountId} />
          )}
          <Tabs value={tab} onValueChange={(v) => setParam('tab', v)} className="mt-6">
            <TabsList>
              <TabsTrigger value="queue">
                <Users /> Antrean prospek
              </TabsTrigger>
              <TabsTrigger value="tasks">
                <ListTodo /> {simple ? 'Pesan & follow-up' : 'Tugas'}
              </TabsTrigger>
              <TabsTrigger value="templates">
                <FileText /> Template
              </TabsTrigger>
            </TabsList>
            <TabsContent value="queue">
              <Queue
                accountId={accountId}
                onSend={(leadId) => {
                  if (!params.get('account')) setParam('account', accountId);
                  setInitialLeadIds([leadId]);
                  setBulkOpen(true);
                }}
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

function Summary({ accountId, simple = false }: { accountId: string; simple?: boolean }) {
  const q = useOutboundSummary(accountId);
  const s = q.data;
  const loading = q.isPending;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard
        label={simple ? 'Kuota tugas hari ini' : 'Tugas baru hari ini'}
        icon={Plus}
        loading={loading}
        value={s ? `${formatNumber(s.createdToday)} / ${formatNumber(s.dailyLimit)}` : '—'}
        hint="Batas harian menjaga penjangkauan tetap personal"
      />
      <>
        <AvailableRecipients accountId={accountId} />
        <StatCard
          label="DM terkirim hari ini"
          icon={Send}
          loading={loading}
          value={formatNumber(s?.sentToday ?? 0)}
          hint="Termasuk follow-up; terkirim atau dikonfirmasi."
        />
      </>
      {!simple && (
        <>
          <StatCard
            label="Follow-up siap"
            icon={CalendarClock}
            loading={loading}
            value={formatNumber(s?.followUpsDue ?? 0)}
          />
          <StatCard
            label="Pesan disiapkan"
            icon={ClipboardCheck}
            loading={loading}
            value={formatNumber(
              (s?.byStatus.WAITING_REVIEW ?? 0) +
                (s?.byStatus.DRAFT ?? 0) +
                (s?.byStatus.APPROVED ?? 0),
            )}
          />
        </>
      )}
      {!simple && (
        <StatCard
          label="Tingkat balasan (7 hari)"
          icon={MessageSquareReply}
          loading={loading}
          value={s?.replyRate == null ? '—' : `${s.replyRate.toLocaleString('id-ID')}%`}
          hint={
            s && (
              <span>
                {formatNumber(s.repliesLast7Days)} balasan dari {formatNumber(s.sentLast7Days)}{' '}
                pesan
              </span>
            )
          }
        />
      )}
    </div>
  );
}

function AvailableRecipients({ accountId }: { accountId: string }) {
  const q = useQueue({ accountId, page: 1, channel: 'TIKTOK_DM' });
  return (
    <Link
      href={`/outbound?account=${accountId}&tab=queue`}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
      aria-label="Lihat penerima tersedia"
    >
      <StatCard
        label="Penerima tersedia"
        icon={Users}
        loading={q.isPending}
        value={
          q.isError ? '-' : `${formatNumber(q.data?.total ?? 0)}${q.data?.truncated ? '+' : ''}`
        }
        hint={
          q.isError ? 'Belum dapat memuat daftar penerima.' : 'Klik untuk melihat calon penerima.'
        }
      />
    </Link>
  );
}

function Queue({
  accountId,
  onSend,
  onTaskCreated,
}: {
  accountId: string;
  onTaskCreated: (id: string) => void;
  onSend: (leadId: string) => void;
}) {
  const { can, user } = useAuth();
  const simple = user.role === 'MARKETING_OPERATOR';
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
        {!simple && (
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
        )}
      </div>
      <p className="flex items-start gap-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {simple ? (
          'Klik Kirim DM pada penerima, atau gunakan tombol Kirim DM di atas untuk memilih beberapa orang sekaligus.'
        ) : (
          <>
            Hanya prospek yang memenuhi syarat: bukan daftar larangan, belum terdaftar, tanpa tugas
            berjalan, memiliki kontak untuk kanal ini
            {channel !== 'TIKTOK_DM' && ', dan sudah memberi izin komunikasi'}.
          </>
        )}
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
                {!simple && <TableHead>Status</TableHead>}
                {!simple && <TableHead>Ketertarikan</TableHead>}
                {!simple && <TableHead>Prioritas</TableHead>}
                <TableHead>Ditambahkan</TableHead>
                {!simple && <TableHead>Kontak terakhir</TableHead>}
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((item) => (
                <TableRow key={item.lead.id}>
                  <TableCell>
                    {user.role === 'SUPER_ADMIN' ? (
                      <Link href={`/leads/${item.lead.id}`} className="font-medium hover:underline">
                        {item.lead.name ?? 'Tanpa nama'}
                      </Link>
                    ) : (
                      <span className="font-medium">{item.lead.name ?? 'Tanpa nama'}</span>
                    )}
                    <p className="max-w-60 truncate text-xs text-muted-foreground">
                      {leadContact(item.lead)}
                    </p>
                  </TableCell>
                  {!simple && (
                    <TableCell>
                      <LeadStatusBadge status={item.lead.status} />
                    </TableCell>
                  )}
                  {!simple && (
                    <TableCell>
                      <InterestBadge level={item.lead.interestLevel} />
                    </TableCell>
                  )}
                  {!simple && (
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
                  )}
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(item.lead.createdAt)}
                  </TableCell>
                  {!simple && (
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelative(item.lead.lastContactedAt)}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {item.lead.tiktokUsername && (
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={`https://www.tiktok.com/@${encodeURIComponent(item.lead.tiktokUsername.replace(/^@/, ''))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Lihat profil @${item.lead.tiktokUsername}`}
                          >
                            <ExternalLink /> Lihat profil
                          </a>
                        </Button>
                      )}
                      {channel === 'TIKTOK_DM' && can(PERMISSIONS.OUTREACH_WORK) && (
                        <Button
                          size="sm"
                          onClick={() => onSend(item.lead.id)}
                          aria-label={`Kirim DM ke @${item.lead.tiktokUsername}`}
                        >
                          <Send /> Kirim DM
                        </Button>
                      )}
                      {!simple && can(PERMISSIONS.OUTREACH_WORK) && (
                        <Button size="sm" variant="outline" onClick={() => setCreating(item)}>
                          <Plus /> Buat tugas
                        </Button>
                      )}
                    </div>
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
            Pesan dibuat dari template dan bisa diubah sebelum dimasukkan ke antrean.
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
      {!HIDE_OFFICIAL_LANE && (
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
      )}
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
  const { user } = useAuth();
  const simple = user.role === 'MARKETING_OPERATOR';
  const [group, setGroup] = useState('action');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const groups = simple
    ? TASK_GROUPS.filter((g) => g.value !== 'review' && g.value !== 'replied').map((g) =>
        g.value === 'action'
          ? { ...g, statuses: [...g.statuses, 'WAITING_REVIEW' as OutreachTaskStatus] }
          : g.value === 'sent'
            ? { ...g, statuses: [...g.statuses, 'REPLIED' as OutreachTaskStatus] }
            : g,
      )
    : TASK_GROUPS;
  const statuses = groups.find((g) => g.value === group)!.statuses;
  const q = useTasks({
    accountId,
    status: statuses.join(','),
    operatorId: mine ? 'me' : undefined,
    page,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {groups.map((g) => (
          <Button
            key={g.value}
            size="sm"
            variant={group === g.value ? 'secondary' : 'ghost'}
            onClick={() => {
              setGroup(g.value);
              setPage(1);
            }}
          >
            {simple && g.value === 'action'
              ? 'Pesan & follow-up'
              : simple && g.value === 'sent'
                ? 'Sudah dikirim'
                : g.label}
          </Button>
        ))}
        {!simple && (
          <Button
            size="sm"
            variant={mine ? 'secondary' : 'ghost'}
            className="ml-auto"
            onClick={() => setMine((m) => !m)}
          >
            Tugas saya
          </Button>
        )}
      </div>
      {q.isPending ? (
        <TableSkeleton cols={5} />
      ) : !q.data?.items.length ? (
        <EmptyState
          icon={ListTodo}
          title={simple ? 'Tidak ada pesan di bagian ini' : 'Tidak ada tugas'}
          description={
            simple
              ? 'Gunakan tombol Kirim DM untuk memilih penerima dan menyiapkan pesan.'
              : 'Buat tugas dari tab Antrean prospek.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Prospek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pesan</TableHead>
                {!simple && <TableHead>Operator</TableHead>}
                <TableHead>Update terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((t) => {
                return (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
                    <TableCell>
                      <p className="font-medium">{t.lead.name ?? 'Tanpa nama'}</p>
                      <p className="text-xs text-muted-foreground">{leadContact(t.lead)}</p>
                    </TableCell>
                    <TableCell>
                      {t.channel === 'TIKTOK_DM' &&
                      ['APPROVED', 'WAITING_REVIEW'].includes(t.status) ? (
                        <Badge variant="secondary">
                          {t.status === 'APPROVED' ? 'Siap dikirim' : 'Belum diantrekan'}
                        </Badge>
                      ) : (
                        <TaskStatusBadge status={t.status} />
                      )}
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
                      <span className="text-muted-foreground">{formatRelative(t.updatedAt)}</span>
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
