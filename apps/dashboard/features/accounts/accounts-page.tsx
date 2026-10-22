'use client';

import {
  LANE_LABELS,
  PERMISSIONS,
  TIKTOK_ACCOUNT_STATUS_LABELS,
  TIKTOK_ACCOUNT_STATUSES,
} from '@smge/shared';
import type { TikTokAccountDto } from '@smge/types';
import {
  BadgeCheck,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Smartphone,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ConfirmDialog,
  DataSourceBadge,
  EmptyState,
  PageHeader,
  Pagination,
  TableSkeleton,
} from '@/components/common';
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
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { formatNumber, formatRelative } from '@/lib/utils';
import {
  HIDE_OFFICIAL_LANE,
  VISIBLE_MARKETING_LANES,
  visibleLaneFilter,
} from '@/lib/marketing-scope';
import { AccountFormDialog } from './account-form-dialog';
import { useAccounts, useDeleteAccount } from './api';
import { AccountStatusBadge, IntegrationBadge, LaneBadge } from './status-badges';

const ALL = '__all__';

export function AccountsPage() {
  const { can, user } = useAuth();
  const canManage = can(PERMISSIONS.ACCOUNTS_MANAGE);
  const [search, setSearch] = useState('');
  const [lane, setLane] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TikTokAccountDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<TikTokAccountDto | null>(null);
  const debouncedSearch = useDebounce(search);
  const del = useDeleteAccount();

  const q = useAccounts({
    page,
    pageSize: 20,
    search: debouncedSearch || undefined,
    lane: visibleLaneFilter(lane === ALL ? undefined : lane),
    status: status === ALL ? undefined : status,
  });
  const filtered = !!debouncedSearch || lane !== ALL || status !== ALL;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Akun TikTok"
        description="Kelola akun TikTok untuk mengambil followers dan mengirim DM."
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus /> Tambah akun
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari username atau nama…"
              className="pl-9"
              aria-label="Cari akun"
            />
          </div>
          {!HIDE_OFFICIAL_LANE && (
            <Select
              value={lane}
              onValueChange={(v) => {
                setLane(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="md:w-52" aria-label="Filter jalur">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Semua jalur</SelectItem>
                {VISIBLE_MARKETING_LANES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LANE_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="md:w-44" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua status</SelectItem>
              {TIKTOK_ACCOUNT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TIKTOK_ACCOUNT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {q.isPending ? (
          <TableSkeleton cols={6} />
        ) : q.isError ? (
          <EmptyState
            title="Gagal memuat data"
            description={q.error.message}
            action={<Button onClick={() => void q.refetch()}>Coba lagi</Button>}
          />
        ) : q.data.items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={Search}
              title="Tidak ada akun yang cocok"
              description="Ubah kata kunci atau filter pencarian."
            />
          ) : (
            <EmptyState
              icon={Smartphone}
              title="Belum ada akun TikTok"
              description="Tambahkan akun TikTok untuk mulai mengambil followers dan menjangkau prospek."
              action={
                canManage && (
                  <Button onClick={openCreate}>
                    <Plus /> Tambah akun pertama
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Akun</TableHead>
                  {!HIDE_OFFICIAL_LANE && <TableHead>Jalur</TableHead>}
                  <TableHead className="text-right">Followers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Integrasi</TableHead>
                  <TableHead>Diperbarui</TableHead>
                  <TableHead className="w-10">
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        href={`/accounts/${a.id}`}
                        className="flex items-center gap-3 hover:underline"
                      >
                        <Avatar account={a} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 font-medium">
                            @{a.username}
                            {a.isVerified && (
                              <BadgeCheck
                                className="size-4 text-brand-text"
                                aria-label="Terverifikasi"
                              />
                            )}
                          </span>
                          <span className="block max-w-56 truncate text-xs text-muted-foreground">
                            {a.displayName}
                          </span>
                          {user.role === 'SUPER_ADMIN' && (
                            <span className="block text-xs text-muted-foreground">
                              Pemilik: {a.owner?.name ?? 'Belum ditetapkan'}
                            </span>
                          )}
                        </span>
                      </Link>
                    </TableCell>
                    {!HIDE_OFFICIAL_LANE && (
                      <TableCell>
                        <LaneBadge lane={a.lane} />
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="font-medium tabular-nums">
                        {formatNumber(a.followersCount)}
                      </div>
                      <DataSourceBadge source={a.followersSource} className="mt-0.5" />
                    </TableCell>
                    <TableCell>
                      <AccountStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>
                      <IntegrationBadge status={a.integrationStatus} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatRelative(a.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Aksi untuk @${a.username}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/accounts/${a.id}`}>
                              <Eye /> Lihat detail
                            </Link>
                          </DropdownMenuItem>
                          {canManage && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(a);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleting(a)}
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
          </>
        )}
      </Card>

      <AccountFormDialog open={formOpen} onOpenChange={setFormOpen} account={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Hapus akun TikTok?"
        confirmLabel="Hapus akun"
        description={
          <>
            Akun <strong>@{deleting?.username}</strong> akan dihapus dari SMGE. Akun yang sudah
            memiliki riwayat percakapan atau tugas outbound tidak dapat dihapus — arsipkan saja.
          </>
        }
        onConfirm={async () => {
          await del.mutateAsync(deleting!.id);
          toast.success('Akun dihapus');
        }}
      />
    </>
  );
}

export function Avatar({
  account,
  size = 36,
}: {
  account: Pick<TikTokAccountDto, 'avatarUrl' | 'username'>;
  size?: number;
}) {
  const initial = account.username[0]?.toUpperCase() ?? '?';
  return account.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL avatar eksternal dari input operator
    <img
      src={account.avatarUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full border object-cover"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {initial}
    </span>
  );
}
