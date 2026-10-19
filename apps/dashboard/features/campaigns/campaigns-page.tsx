'use client';

import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPE_LABELS,
  LANE_LABELS,
  MARKETING_LANES,
  PERMISSIONS,
} from '@smge/shared';
import type { CampaignDto } from '@smge/types';
import { Eye, Megaphone, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Pagination,
  TableSkeleton,
} from '@/components/common';
import { CampaignStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import {
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
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { LaneBadge } from '@/features/accounts/status-badges';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber } from '@/lib/utils';
import { useCampaigns, useDeleteCampaign } from './api';
import { CampaignFormDialog } from './campaign-form-dialog';

const ALL = '__all__';

export function formatPeriod(c: Pick<CampaignDto, 'startDate' | 'endDate'>) {
  const f = (iso: string) =>
    new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(iso));
  if (!c.startDate && !c.endDate) return 'Belum dijadwalkan';
  return `${c.startDate ? f(c.startDate) : '…'} – ${c.endDate ? f(c.endDate) : '…'}`;
}

export const formatRupiah = (v: string | number | null) =>
  v === null || v === '' ? '—' : `Rp${formatNumber(Number(v))}`;

export function CampaignsPage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.CAMPAIGNS_MANAGE);
  const [search, setSearch] = useState('');
  const [lane, setLane] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignDto | null>(null);
  const [deleting, setDeleting] = useState<CampaignDto | null>(null);
  const debounced = useDebounce(search);
  const del = useDeleteCampaign();

  const q = useCampaigns({
    page,
    pageSize: 20,
    search: debounced || undefined,
    lane: lane === ALL ? undefined : lane,
    status: status === ALL ? undefined : status,
  });
  const filtered = !!debounced || lane !== ALL || status !== ALL;
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v);
      setPage(1);
    };

  return (
    <>
      <PageHeader
        title="Campaign"
        description="Kelola aktivitas pemasaran Jalur A dan Jalur B beserta hasilnya."
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus /> Buat campaign
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Cari nama atau kode tracking…"
              value={search}
              onChange={(e) => reset(setSearch)(e.target.value)}
              aria-label="Cari campaign"
            />
          </div>
          <Select value={lane} onValueChange={reset(setLane)}>
            <SelectTrigger className="md:w-52" aria-label="Filter jalur">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua jalur</SelectItem>
              {MARKETING_LANES.map((l) => (
                <SelectItem key={l} value={l}>
                  {LANE_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={reset(setStatus)}>
            <SelectTrigger className="md:w-48" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua (kecuali arsip)</SelectItem>
              {CAMPAIGN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {CAMPAIGN_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {q.isPending ? (
          <TableSkeleton cols={6} />
        ) : q.isError ? (
          <EmptyState title="Gagal memuat campaign" description={q.error.message} />
        ) : !q.data.items.length ? (
          <EmptyState
            icon={filtered ? Search : Megaphone}
            title={filtered ? 'Tidak ada campaign yang cocok' : 'Belum ada campaign'}
            description={
              filtered
                ? 'Ubah kata kunci atau filter.'
                : 'Buat campaign untuk mengelompokkan prospek dan mengukur hasil promosi.'
            }
            action={
              !filtered &&
              canManage && (
                <Button onClick={openCreate}>
                  <Plus /> Buat campaign pertama
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Jalur</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Prospek</TableHead>
                  <TableHead className="text-right">Registrasi*</TableHead>
                  <TableHead className="text-right">Biaya / lead</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {CAMPAIGN_TYPE_LABELS[c.type]} · {c.accounts.length} akun
                      </p>
                    </TableCell>
                    <TableCell>
                      <LaneBadge lane={c.lane} />
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatPeriod(c)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(c.stats.leads)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(c.stats.registrationsVerified)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(c.stats.costPerLead)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${c.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/campaigns/${c.id}`}>
                              <Eye /> Lihat detail
                            </Link>
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(c);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleting(c)}
                              >
                                <Trash2 /> Hapus
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              * Registrasi terverifikasi dari backend Solid Mini (atribusi last-touch). Rincian di
              halaman Analitik.
            </p>
          </>
        )}
      </Card>

      <CampaignFormDialog open={formOpen} onOpenChange={setFormOpen} campaign={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Hapus campaign?"
        confirmLabel="Hapus"
        description={
          <>
            Campaign <strong>{deleting?.name}</strong> akan dihapus. Campaign yang sudah memiliki
            prospek atau aktivitas tidak dapat dihapus — ubah statusnya menjadi Diarsipkan.
          </>
        }
        onConfirm={async () => {
          await del.mutateAsync(deleting!.id);
          toast.success('Campaign dihapus');
        }}
      />
    </>
  );
}
