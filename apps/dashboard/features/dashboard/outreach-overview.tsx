'use client';

import { PERMISSIONS, TIKTOK_ACCOUNT_STATUS_LABELS } from '@smge/shared';
import type { DashboardDeliveryItem, DashboardOutreachOverview } from '@smge/types';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Send,
  Smartphone,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { EmptyState, StatCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime, formatNumber } from '@/lib/utils';

const DELIVERY_LABELS = {
  QUEUED: 'Menunggu extension',
  PROCESSING: 'Sedang diproses',
  SENT: 'Terkirim / dikonfirmasi',
  FAILED: 'Gagal',
  UNVERIFIED: 'Perlu diperiksa',
  CANCELLED: 'Dibatalkan',
};

export function OutreachOverview({
  data,
  loading,
}: {
  data?: DashboardOutreachOverview;
  loading: boolean;
}) {
  const { can, user } = useAuth();
  const work = can(PERMISSIONS.OUTREACH_WORK);
  const accounts = can(PERMISSIONS.ACCOUNTS_READ);
  const team = user.role === 'SUPER_ADMIN';
  const number = (value?: number) => (data ? formatNumber(value ?? 0) : '-');
  const attention = (data?.deliveries.FAILED ?? 0) + (data?.deliveries.UNVERIFIED ?? 0);
  if (!data && !loading) return null;
  const recentItem = (item: DashboardDeliveryItem, issue = false) => (
    <div
      key={item.id}
      className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">@{item.username}</p>
          <Badge
            variant={
              item.status === 'SENT'
                ? 'success'
                : item.status === 'FAILED'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {DELIVERY_LABELS[item.status]}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          via @{item.accountUsername} ? {formatDateTime(item.updatedAt)}
        </p>
        {issue && item.detail && (
          <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
        )}
      </div>
      {work && (
        <Button variant="outline" size="sm" asChild>
          <Link
            href={
              issue
                ? `/outbound?account=${item.accountId}&tab=tasks#dm-delivery-status`
                : `/outbound?account=${item.accountId}&tab=tasks&task=${item.taskId}`
            }
          >
            {issue ? 'Periksa' : 'Buka pesan'}
            <ArrowRight />
          </Link>
        </Button>
      )}
    </div>
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {work && (
          <Button asChild>
            <Link href="/outbound">
              <Send /> Ambil followers & kirim DM
            </Link>
          </Button>
        )}
        {accounts && (
          <Button variant="outline" asChild>
            <Link href="/accounts">
              <Smartphone /> Akun TikTok
            </Link>
          </Button>
        )}
        {can(PERMISSIONS.USERS_READ) && (
          <Button variant="outline" asChild>
            <Link href="/settings?tab=pengguna">
              <Users /> Kelola user
            </Link>
          </Button>
        )}
        {!work && (
          <p className="text-sm text-muted-foreground">Tampilan baca saja sesuai hak akses Anda.</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={team ? 'Akun tim aktif' : 'Akun TikTok aktif'}
          icon={Smartphone}
          value={number(data?.activeAccounts)}
          loading={loading}
          hint={team ? 'Semua pemilik akun.' : 'Akun pengirim milik Anda.'}
        />
        <StatCard
          label="Followers tersimpan"
          icon={Users}
          value={number(data?.followersCollected)}
          loading={loading}
          hint="Data followers yang sudah masuk database."
        />
        <StatCard
          label="DM terkirim hari ini"
          icon={Send}
          value={number(data?.sentToday)}
          loading={loading}
          hint="Termasuk follow-up dan konfirmasi manual."
        />
        <StatCard
          label="Perlu diperiksa"
          icon={AlertCircle}
          value={number(attention)}
          loading={loading}
          hint="Pengiriman gagal atau hasil belum pasti."
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Status pengiriman {team ? 'tim' : 'Anda'}</CardTitle>
          <CardDescription>
            Hasil tercatat di aplikasi; bukan bukti pesan sudah dibaca.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" /> Menunggu extension
            </p>
            <p className="mt-1 text-xl font-semibold">{number(data?.deliveries.QUEUED)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Send className="size-4" /> Sedang diproses
            </p>
            <p className="mt-1 text-xl font-semibold">{number(data?.deliveries.PROCESSING)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" /> DM terkirim 7 hari
            </p>
            <p className="mt-1 text-xl font-semibold">{number(data?.sentLast7Days)}</p>
          </div>
        </CardContent>
      </Card>
      {!!data?.issues.length && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Pengiriman perlu perhatian</CardTitle>
            <CardDescription>
              Periksa hasil di TikTok sebelum mencoba mengirim ulang.
            </CardDescription>
          </CardHeader>
          <CardContent>{data.issues.map((item) => recentItem(item, true))}</CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{team ? 'Akun pengirim tim' : 'Akun pengirim Anda'}</CardTitle>
            {accounts && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/accounts">
                  Lihat semua akun <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
          <CardDescription>Pilih akun untuk melanjutkan pekerjaan.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-36 w-full" />
          ) : !data?.accounts.length ? (
            <EmptyState
              icon={Smartphone}
              title="Belum ada akun pengirim"
              description={
                can(PERMISSIONS.ACCOUNTS_MANAGE)
                  ? 'Tambahkan akun TikTok, lalu ambil followers dan siapkan DM.'
                  : 'Belum ada data akun pada akses Anda.'
              }
              action={
                can(PERMISSIONS.ACCOUNTS_MANAGE) ? (
                  <Button asChild size="sm">
                    <Link href="/accounts">Tambah akun TikTok</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Akun TikTok</TableHead>
                  {team && <TableHead>Pemilik</TableHead>}
                  <TableHead>Followers tersimpan</TableHead>
                  <TableHead>DM hari ini</TableHead>
                  <TableHead>Status</TableHead>
                  {(work || accounts) && <TableHead>Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <p className="font-medium">@{account.username}</p>
                      <p className="text-xs text-muted-foreground">{account.displayName}</p>
                    </TableCell>
                    {team && <TableCell>{account.owner?.name ?? 'Belum ditetapkan'}</TableCell>}
                    <TableCell>{formatNumber(account.followersCollected)}</TableCell>
                    <TableCell>{formatNumber(account.sentToday)}</TableCell>
                    <TableCell>
                      <Badge variant={account.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {TIKTOK_ACCOUNT_STATUS_LABELS[account.status]}
                      </Badge>
                    </TableCell>
                    {(work || accounts) && (
                      <TableCell>
                        {work && account.status === 'ACTIVE' ? (
                          <Button size="sm" asChild>
                            <Link href={`/outbound?account=${account.id}`}>
                              Buka outbound <ArrowRight />
                            </Link>
                          </Button>
                        ) : accounts ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/accounts/${account.id}`}>Lihat akun</Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pengiriman terbaru</CardTitle>
          <CardDescription>
            {team
              ? 'Aktivitas dari semua akun pengirim.'
              : 'Aktivitas dari akun pengirim milik Anda.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : !data?.recent.length ? (
            <EmptyState
              icon={Send}
              title="Belum ada pengiriman"
              description="Hasil akan muncul setelah pesan disiapkan melalui Outbound."
            />
          ) : (
            data.recent.map((item) => recentItem(item))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
