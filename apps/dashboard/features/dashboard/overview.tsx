'use client';

import { LANE_LABELS, LANE_SHORT_LABELS, type MarketingLane } from '@smge/shared';
import type { DashboardOverview } from '@smge/types';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  FlaskConical,
  Megaphone,
  MessagesSquare,
  Send,
  Smartphone,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataSourceBadge, EmptyState, PageHeader, StatCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { HIDE_OFFICIAL_LANE, VISIBLE_MARKETING_LANES, isVisibleLane } from '@/lib/marketing-scope';
import { formatCompact, formatDateTime, formatNumber } from '@/lib/utils';
import { OutreachOverview } from './outreach-overview';

export const LANE_COLOR: Record<MarketingLane, string> = {
  OFFICIAL: 'var(--lane-official)',
  OUTBOUND: 'var(--lane-outbound)',
};

export function LaneDot({ lane }: { lane: MarketingLane }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: LANE_COLOR[lane] }}
    />
  );
}

export function DashboardOverviewPage() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['analytics', 'overview', user.id],
    queryFn: () => api.get<DashboardOverview>('/analytics/overview'),
    refetchInterval: 15000,
  });
  const d = q.data;
  const loading = q.isPending;
  const m = d?.metrics;
  const visibleAccounts = d?.accounts.byLane.filter((a) => isVisibleLane(a.lane));
  const accountTotal = HIDE_OFFICIAL_LANE
    ? visibleAccounts?.reduce((sum, a) => sum + a.accounts, 0)
    : d?.accounts.total;
  const followerTotal = HIDE_OFFICIAL_LANE
    ? visibleAccounts?.reduce((sum, a) => sum + a.followers, 0)
    : d?.accounts.totalFollowers;

  return (
    <>
      <PageHeader
        title={`Halo, ${user.name.split(' ')[0]}`}
        description={
          user.role === 'SUPER_ADMIN'
            ? 'Ringkasan followers dan pengiriman DM seluruh tim.'
            : user.role === 'VIEWER'
              ? 'Ringkasan data yang dapat Anda akses.'
              : 'Pantau followers tersimpan dan hasil pengiriman DM milik Anda.'
        }
      />

      {q.isError && (
        <Card className="mb-6 border-destructive/40 p-4 text-sm text-destructive">
          <p>Gagal memuat ringkasan: {q.error.message}</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Coba lagi
          </Button>
        </Card>
      )}

      <OutreachOverview data={d?.outreach} loading={loading} />
      <details className="mt-6 rounded-xl border p-4" open={user.role !== 'MARKETING_OPERATOR'}>
        <summary className="cursor-pointer font-semibold">Detail akun & prospek</summary>
        <p className="my-3 text-sm text-muted-foreground">
          Followers di profil adalah angka aktual atau input manual, terpisah dari data followers
          yang sudah diimpor.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Akun TikTok"
            icon={Smartphone}
            loading={loading}
            value={formatNumber(accountTotal ?? 0)}
            hint={!HIDE_OFFICIAL_LANE && d && <span>{formatNumber(d.accounts.active)} aktif</span>}
          />
          <StatCard
            label="Followers di profil"
            icon={Users}
            loading={loading}
            value={formatNumber(followerTotal ?? 0)}
            source={
              !HIDE_OFFICIAL_LANE &&
              d &&
              d.accounts.followersBySource.ACTUAL === 0 &&
              d.accounts.totalFollowers > 0
                ? 'MANUAL'
                : null
            }
            hint={
              d && d.accounts.followersBySource.SIMULATED > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <FlaskConical className="size-3" />{' '}
                  {formatCompact(d.accounts.followersBySource.SIMULATED)} simulasi tidak dihitung
                </span>
              ) : (
                d && <span>Aktual + input manual</span>
              )
            }
          />
          {!HIDE_OFFICIAL_LANE && (
            <StatCard
              label="Campaign aktif"
              icon={Megaphone}
              loading={loading}
              value={formatNumber(m?.activeCampaigns.value ?? 0)}
            />
          )}
          <StatCard
            label="Total prospek"
            icon={UserPlus}
            loading={loading}
            value={formatNumber(m?.totalLeads.value ?? 0)}
          />
          <StatCard
            label="Prospek tertarik"
            icon={Sparkles}
            loading={loading}
            value={formatNumber(m?.interestedLeads.value ?? 0)}
          />
          {!HIDE_OFFICIAL_LANE && (
            <StatCard
              label="Percakapan"
              icon={MessagesSquare}
              loading={loading}
              value={formatNumber(m?.conversations.value ?? 0)}
            />
          )}
          <StatCard
            label="Tugas outbound terbuka"
            icon={Send}
            loading={loading}
            value={formatNumber(m?.outreachTasks.value ?? 0)}
          />
          {!HIDE_OFFICIAL_LANE && (
            <StatCard
              label="Registrasi terverifikasi"
              icon={UserCheck}
              loading={loading}
              value={formatNumber(m?.registrations.value ?? 0)}
              hint={
                m && (
                  <span>
                    {formatNumber(m.activeUsers.value ?? 0)} aktif ·{' '}
                    {formatNumber(m.registrationsOperator.value ?? 0)} dikonfirmasi operator
                  </span>
                )
              }
            />
          )}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Followers per akun</CardTitle>
              <CardDescription>
                10 akun teratas. Batang bergaris putus-putus = data simulasi.
              </CardDescription>
              <LaneLegend />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-72 w-full" />
              ) : !d?.accounts.top.filter((a) => isVisibleLane(a.lane)).length ? (
                <EmptyState
                  icon={Smartphone}
                  title="Belum ada akun TikTok"
                  description="Tambahkan akun TikTok untuk mulai memantau performa."
                  action={
                    <Button asChild size="sm">
                      <Link href="/accounts">Kelola akun</Link>
                    </Button>
                  }
                />
              ) : (
                <FollowersChart data={d.accounts.top.filter((a) => isVisibleLane(a.lane))} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {HIDE_OFFICIAL_LANE ? 'Ringkasan akun outreach' : 'Jalur A vs Jalur B'}
              </CardTitle>
              <CardDescription>Jumlah akun dan followers</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {loading
                ? [0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)
                : d?.accounts.byLane
                    .filter((l) => isVisibleLane(l.lane))
                    .map((l) => {
                      const share = d.accounts.totalFollowers
                        ? (l.followers / d.accounts.totalFollowers) * 100
                        : 0;
                      return (
                        <div key={l.lane} className="rounded-lg border p-4">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <LaneDot lane={l.lane} /> {LANE_LABELS[l.lane]}
                          </div>
                          <p className="mt-2 text-2xl font-semibold tabular-nums">
                            {formatNumber(l.followers)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            followers dari {formatNumber(l.accounts)} akun
                            {l.simulatedFollowers > 0 &&
                              ` · ${formatCompact(l.simulatedFollowers)} simulasi tidak dihitung`}
                          </p>
                          <div
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
                            aria-hidden
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${share}%`, background: LANE_COLOR[l.lane] }}
                            />
                          </div>
                        </div>
                      );
                    })}
            </CardContent>
          </Card>
        </div>
      </details>
      {d && (
        <p className="mt-4 text-xs text-muted-foreground">
          Diperbarui {formatDateTime(d.generatedAt)}. Ringkasan diperbarui otomatis.
        </p>
      )}
      {d && !HIDE_OFFICIAL_LANE && (
        <p className="mt-6 text-xs text-muted-foreground">
          Diperbarui {formatDateTime(d.generatedAt)}. Metrik registrasi, aktivasi, dan biaya per
          konversi akan tersedia setelah integrasi backend Solid Mini (Fase 5).
        </p>
      )}
    </>
  );
}

export function LaneLegend() {
  return (
    <div
      className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground"
      aria-label="Legenda jalur"
    >
      {VISIBLE_MARKETING_LANES.map((lane) => (
        <span key={lane} className="inline-flex items-center gap-1.5">
          <LaneDot lane={lane} /> {LANE_LABELS[lane]}
        </span>
      ))}
    </div>
  );
}

type TopAccount = DashboardOverview['accounts']['top'][number];

function FollowersChart({ data }: { data: TopAccount[] }) {
  const rows = data.map((a) => ({ ...a, label: `@${a.username}` }));
  return (
    <div
      style={{ height: Math.max(220, rows.length * 36 + 40) }}
      role="img"
      aria-label="Grafik followers per akun TikTok"
    >
      <svg width="0" height="0" className="absolute">
        <defs>
          {VISIBLE_MARKETING_LANES.map((lane) => (
            <pattern
              key={lane}
              id={`sim-${lane}`}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill={LANE_COLOR[lane]} opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={LANE_COLOR[lane]} strokeWidth="3" />
            </pattern>
          ))}
        </defs>
      </svg>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
          barCategoryGap={6}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatCompact(v)}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fontSize: 12, fill: 'var(--foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<FollowersTooltip />} />
          <Bar dataKey="followersCount" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {rows.map((r) => (
              <Cell
                key={r.id}
                fill={
                  r.followersSource === 'SIMULATED' ? `url(#sim-${r.lane})` : LANE_COLOR[r.lane]
                }
                stroke={r.followersSource === 'SIMULATED' ? LANE_COLOR[r.lane] : undefined}
                strokeDasharray={r.followersSource === 'SIMULATED' ? '4 2' : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FollowersTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TopAccount & { label: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const a = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="flex items-center gap-1.5 font-medium">
        {a.label}{' '}
        {a.isVerified && (
          <BadgeCheck className="size-3.5 text-brand-text" aria-label="Terverifikasi" />
        )}
      </p>
      <p className="text-xs text-muted-foreground">{a.displayName}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <LaneDot lane={a.lane} />
        <span className="text-xs">{LANE_SHORT_LABELS[a.lane]}</span>
        <span className="ml-auto font-semibold tabular-nums">{formatNumber(a.followersCount)}</span>
      </div>
      <div className="mt-1.5">
        <DataSourceBadge source={a.followersSource} />
      </div>
    </div>
  );
}
