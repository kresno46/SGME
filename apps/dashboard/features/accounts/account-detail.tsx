'use client';

import {
  INTEGRATION_PROVIDER_LABELS,
  LANE_LABELS,
  PERMISSIONS,
  TIKTOK_ACCOUNT_TYPE_LABELS,
} from '@smge/shared';
import {
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  FlaskConical,
  Megaphone,
  Pencil,
  Send,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataSourceBadge, EmptyState, StatCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { HIDE_OFFICIAL_LANE } from '@/lib/marketing-scope';
import { AccountFormDialog } from './account-form-dialog';
import { Avatar } from './accounts-page';
import { useAccount } from './api';
import { AccountStatusBadge, IntegrationBadge, LaneBadge } from './status-badges';

export function AccountDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const q = useAccount(id);
  const [editOpen, setEditOpen] = useState(false);

  if (q.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <EmptyState
        title="Akun tidak dapat dimuat"
        description={q.error.message}
        action={
          <Button asChild variant="outline">
            <Link href="/accounts">Kembali ke daftar</Link>
          </Button>
        }
      />
    );
  }
  const a = q.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/accounts">
          <ArrowLeft /> Semua akun
        </Link>
      </Button>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar account={a} size={56} />
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            @{a.username}
            {a.isVerified && (
              <BadgeCheck className="size-5 text-brand-text" aria-label="Terverifikasi" />
            )}
          </h1>
          <p className="text-muted-foreground">{a.displayName}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <LaneBadge lane={a.lane} />
            <AccountStatusBadge status={a.status} />
            <Badge variant="outline">{TIKTOK_ACCOUNT_TYPE_LABELS[a.accountType]}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {a.profileUrl && (
            <Button asChild variant="outline">
              <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Buka profil
              </a>
            </Button>
          )}
          {can(PERMISSIONS.ACCOUNTS_MANAGE) && (
            <Button onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Followers"
          icon={Users}
          value={formatNumber(a.followersCount)}
          source={a.followersSource}
        />
        {!HIDE_OFFICIAL_LANE && (
          <StatCard label="Campaign" icon={Megaphone} value={formatNumber(a.stats.campaigns)} />
        )}
        <StatCard
          label="Prospek bersumber dari akun"
          icon={UserPlus}
          value={formatNumber(a.stats.leads)}
        />
        <StatCard label="Tugas outbound" icon={Send} value={formatNumber(a.stats.outreachTasks)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi akun</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              {!HIDE_OFFICIAL_LANE && (
                <>
                  <dt className="text-muted-foreground">Jalur</dt>
                  <dd>{LANE_LABELS[a.lane]}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Sumber angka followers</dt>
              <dd>
                <DataSourceBadge source={a.followersSource} />
              </dd>
              <dt className="text-muted-foreground">Sinkronisasi terakhir</dt>
              <dd>
                {a.lastSyncedAt ? formatDateTime(a.lastSyncedAt) : 'Belum pernah (input manual)'}
              </dd>
              <dt className="text-muted-foreground">Ditambahkan</dt>
              <dd>{formatDateTime(a.createdAt)}</dd>
              <dt className="text-muted-foreground">Catatan</dt>
              <dd className="whitespace-pre-wrap">{a.notes || '—'}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Status integrasi API</CardTitle>
            <IntegrationBadge status={a.integrationStatus} />
          </CardHeader>
          <CardContent>
            {a.integrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Akun belum terhubung ke API resmi TikTok. Koneksi OAuth akan tersedia di menu
                Integrasi (Fase 4) setelah aplikasi SMGE memperoleh persetujuan akses dari TikTok.
              </p>
            ) : (
              <ul className="grid gap-3">
                {a.integrations.map((i) => (
                  <li key={i.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{INTEGRATION_PROVIDER_LABELS[i.provider]}</span>
                      <IntegrationBadge status={i.status} />
                      {i.isSimulation && (
                        <Badge variant="simulation">
                          <FlaskConical /> Simulasi
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sinkron terakhir: {formatDateTime(i.lastSyncAt)}
                      {i.tokenExpiresAt &&
                        ` · Token berlaku s.d. ${formatDateTime(i.tokenExpiresAt)}`}
                    </p>
                    {i.lastError && <p className="mt-1 text-xs text-destructive">{i.lastError}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Grafik performa per akun (prospek, registrasi, aktivasi) akan tersedia setelah modul
        tracking konversi (Fase 5).
      </p>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={a} />
    </>
  );
}
