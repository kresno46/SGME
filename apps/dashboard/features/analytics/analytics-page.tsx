'use client';

import {
  ATTRIBUTION_MODEL_LABELS,
  CAMPAIGN_STATUS_LABELS,
  LANE_LABELS,
  LANE_SHORT_LABELS,
  LEAD_STATUS_LABELS,
  type AttributionModel,
  type CampaignStatus,
  type LeadStatus,
  type MarketingLane,
} from '@smge/shared';
import type { AnalyticsReportDto } from '@smge/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bot,
  Coins,
  MousePointerClick,
  ShieldQuestion,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataSourceBadge, EmptyState, PageHeader, StatCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
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
import { LaneBadge } from '@/features/accounts/status-badges';
import { formatUsd } from '@/features/ai/ai-common';
import { formatRupiah } from '@/features/campaigns/campaigns-page';
import { LANE_COLOR, LaneDot } from '@/features/dashboard/overview';
import { useCampaignOptions } from '@/hooks/use-lookups';
import { api } from '@/lib/api';
import {
  HIDE_OFFICIAL_LANE,
  VISIBLE_MARKETING_LANES,
  visibleLaneFilter,
  isVisibleLane,
} from '@/lib/marketing-scope';
import { formatNumber } from '@/lib/utils';

const ALL = '__all__';
const RANGES = [7, 30, 90];
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('id-ID')}%`);

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [lane, setLane] = useState(ALL);
  const [campaignId, setCampaignId] = useState(ALL);
  const [model, setModel] = useState<AttributionModel>('LAST_TOUCH');
  const campaigns = useCampaignOptions();
  const q = useQuery({
    queryKey: ['analytics', 'report', { days, lane, campaignId, model }],
    queryFn: () =>
      api.get<AnalyticsReportDto>('/analytics/report', {
        days,
        model,
        lane: visibleLaneFilter(lane === ALL ? undefined : lane),
        campaignId: campaignId === ALL ? undefined : campaignId,
      }),
    placeholderData: keepPreviousData,
  });
  const r = q.data;
  const k = r?.kpis;
  const loading = q.isPending;

  return (
    <>
      <PageHeader
        title="Analitik"
        description="Efektivitas pemasaran dari kunjungan sampai registrasi & aktivasi. Hanya registrasi dari backend Solid Mini yang dihitung terverifikasi."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RANGES.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? 'secondary' : 'ghost'}
            onClick={() => setDays(d)}
          >
            {d} hari
          </Button>
        ))}
        {!HIDE_OFFICIAL_LANE && (
          <Select value={lane} onValueChange={setLane}>
            <SelectTrigger className="h-8 w-48" aria-label="Filter jalur">
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
        <Select value={campaignId} onValueChange={setCampaignId}>
          <SelectTrigger className="h-8 w-56" aria-label="Filter campaign">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua campaign</SelectItem>
            {campaigns.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
          <SelectTrigger className="h-8 w-60" aria-label="Model atribusi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['LAST_TOUCH', 'FIRST_TOUCH'] as const).map((m) => (
              <SelectItem key={m} value={m}>
                {ATTRIBUTION_MODEL_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {q.isError && <EmptyState title="Gagal memuat analitik" description={q.error.message} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Prospek baru"
          icon={UserPlus}
          loading={loading}
          value={formatNumber(k?.leads ?? 0)}
          hint={
            k && (
              <span>
                {formatNumber(k.contacted)} dihubungi · {formatNumber(k.replies)} membalas
              </span>
            )
          }
        />
        <StatCard
          label="Pengunjung dari link"
          icon={MousePointerClick}
          loading={loading}
          value={formatNumber(k?.visitors ?? 0)}
          hint={
            <span className="inline-flex items-center gap-1">
              <ShieldQuestion className="size-3" /> tidak terverifikasi
            </span>
          }
        />
        <StatCard
          label="Registrasi terverifikasi"
          icon={BadgeCheck}
          loading={loading}
          value={formatNumber(k?.registrationsVerified ?? 0)}
          hint={
            k && (
              <span>
                Konversi {pct(k.conversionRate)} · {formatNumber(k.registrationsOperator)} lain
                dikonfirmasi operator
              </span>
            )
          }
        />
        <StatCard
          label="Pengguna aktif terverifikasi"
          icon={UserCheck}
          loading={loading}
          value={formatNumber(k?.activationsVerified ?? 0)}
          hint={k && <span>{formatNumber(k.installsVerified)} instalasi terverifikasi</span>}
        />
        <StatCard
          label="Biaya campaign"
          icon={Coins}
          loading={loading}
          value={formatRupiah(k?.spend ?? 0)}
          hint={
            k && (
              <span className="flex flex-wrap gap-1">
                {k.spendSources.map((s) => (
                  <DataSourceBadge key={s} source={s} />
                ))}
                {!k.spendSources.length && 'Belum ada biaya tercatat'}
              </span>
            )
          }
        />
        <StatCard
          label="Biaya per lead"
          icon={Coins}
          loading={loading}
          value={formatRupiah(k?.costPerLead ?? null)}
        />
        <StatCard
          label="Biaya per registrasi"
          icon={Coins}
          loading={loading}
          value={formatRupiah(k?.costPerRegistration ?? null)}
          hint="Registrasi terverifikasi"
        />
        <StatCard
          label="Biaya AI"
          icon={Bot}
          loading={loading}
          value={formatUsd(k?.aiCostUsd ?? 0)}
          hint={
            <Link href="/ai-sales?tab=usage" className="text-brand-text hover:underline">
              Rincian →
            </Link>
          }
        />
      </div>

      {r && (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <FunnelCard report={r} />
            <GrowthCard report={r} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <LaneCard report={r} />
            <StatusCard report={r} />
          </div>
          <CampaignTable report={r} />
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <AccountTable report={r} />
            <OperatorTable report={r} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Periode{' '}
            {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
              new Date(r.range.from),
            )}{' '}
            – sekarang · {ATTRIBUTION_MODEL_LABELS[r.range.model]}. Biaya = total biaya campaign
            yang berjalan dalam periode. Data simulasi tidak dihitung.
          </p>
        </>
      )}
      {loading && <Skeleton className="mt-6 h-72 w-full" />}
    </>
  );
}

function FunnelCard({ report }: { report: AnalyticsReportDto }) {
  const data = report.funnel.map((f) => ({
    ...f,
    short: f.label.replace('Kunjungan landing page', 'Kunjungan').replace(' terverifikasi', ''),
  }));
  const empty = data.every((d) => d.count === 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Funnel konversi</CardTitle>
        <CardDescription>
          Pengunjung unik → pengguna unik. Tiga tahap terakhir hanya dari backend Solid Mini.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <EmptyState
            title="Belum ada data konversi"
            description="Buat link tracking di halaman campaign dan hubungkan Conversion API."
            className="py-10"
          />
        ) : (
          <div className="h-64" role="img" aria-label="Grafik funnel konversi">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="short"
                  width={140}
                  tick={{ fontSize: 12, fill: 'var(--foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof data)[number];
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                        <p className="font-medium">{d.label}</p>
                        <p className="tabular-nums">{formatNumber(d.count)}</p>
                        <p className="text-muted-foreground">
                          {d.verified
                            ? 'Terverifikasi backend Solid Mini'
                            : 'Tidak terverifikasi (klik/kunjungan)'}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GrowthCard({ report }: { report: AnalyticsReportDto }) {
  const hasNone = report.leadsGrowth.some((d) => d.NONE > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pertumbuhan prospek</CardTitle>
        <CardDescription>Prospek baru per hari menurut jalur sumber</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64" role="img" aria-label="Grafik prospek baru per hari per jalur">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={report.leadsGrowth} margin={{ left: -16, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(d: string) =>
                  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(d))
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {!HIDE_OFFICIAL_LANE && (
                <Line
                  type="monotone"
                  dataKey="OFFICIAL"
                  name={LANE_SHORT_LABELS.OFFICIAL}
                  stroke={LANE_COLOR.OFFICIAL}
                  strokeWidth={2}
                  dot={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="OUTBOUND"
                name={LANE_SHORT_LABELS.OUTBOUND}
                stroke={LANE_COLOR.OUTBOUND}
                strokeWidth={2}
                dot={false}
              />
              {hasNone && (
                <Line
                  type="monotone"
                  dataKey="NONE"
                  name="Tanpa jalur"
                  stroke="var(--muted-foreground)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function LaneCard({ report }: { report: AnalyticsReportDto }) {
  const rows: Array<[string, (l: AnalyticsReportDto['lanes'][number]) => string]> = [
    ['Prospek', (l) => formatNumber(l.leads)],
    ['Dihubungi', (l) => formatNumber(l.contacted)],
    ['Membalas', (l) => formatNumber(l.replies)],
    ['Registrasi', (l) => formatNumber(l.registrations)],
    ['Aktivasi', (l) => formatNumber(l.activations)],
    ['Biaya', (l) => formatRupiah(l.spend)],
    ['Biaya / lead', (l) => formatRupiah(l.costPerLead)],
    ['Biaya / registrasi', (l) => formatRupiah(l.costPerRegistration)],
  ];
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{HIDE_OFFICIAL_LANE ? 'Performa outreach' : 'Jalur A vs Jalur B'}</CardTitle>
        <CardDescription>
          Registrasi & aktivasi terverifikasi diatribusikan ke campaign sesuai model terpilih
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Metrik</TableHead>
            {report.lanes
              .filter((l) => isVisibleLane(l.lane as MarketingLane))
              .map((l) => (
                <TableHead key={l.lane} className="text-right">
                  <span className="inline-flex items-center gap-1.5">
                    <LaneDot lane={l.lane as MarketingLane} />{' '}
                    {LANE_SHORT_LABELS[l.lane as MarketingLane]}
                  </span>
                </TableHead>
              ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, fn]) => (
            <TableRow key={label}>
              <TableCell className="text-sm text-muted-foreground">{label}</TableCell>
              {report.lanes
                .filter((l) => isVisibleLane(l.lane as MarketingLane))
                .map((l) => (
                  <TableCell key={l.lane} className="text-right tabular-nums">
                    {fn(l)}
                  </TableCell>
                ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function StatusCard({ report }: { report: AnalyticsReportDto }) {
  const max = Math.max(1, ...report.leadStatus.map((s) => s.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status prospek</CardTitle>
        <CardDescription>Kondisi saat ini</CardDescription>
      </CardHeader>
      <CardContent>
        {!report.leadStatus.length ? (
          <p className="text-sm text-muted-foreground">Belum ada prospek.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {report.leadStatus.map((s) => (
              <li key={s.status} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
                <span className="truncate">
                  {LEAD_STATUS_LABELS[s.status as LeadStatus] ?? s.status}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${(s.count / max) * 100}%` }}
                  />
                </span>
                <span className="tabular-nums text-muted-foreground">{formatNumber(s.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CampaignTable({ report }: { report: AnalyticsReportDto }) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Performa campaign</CardTitle>
      </CardHeader>
      {!report.campaigns.length ? (
        <EmptyState title="Belum ada campaign dalam periode ini" className="py-8" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Campaign</TableHead>
              <TableHead className="text-right">Prospek</TableHead>
              <TableHead className="text-right">Pengunjung</TableHead>
              <TableHead className="text-right">Registrasi</TableHead>
              <TableHead className="text-right">Konversi</TableHead>
              <TableHead className="text-right">Biaya</TableHead>
              <TableHead className="text-right">/ lead</TableHead>
              <TableHead className="text-right">/ registrasi</TableHead>
              <TableHead className="text-right">/ aktivasi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-1 flex gap-1">
                    <LaneBadge lane={c.lane} />
                    <Badge variant="outline">
                      {CAMPAIGN_STATUS_LABELS[c.status as CampaignStatus]}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(c.leads)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(c.visitors)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(c.registrations)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pct(c.conversionRate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(c.spend)}
                  {c.spend > 0 && <DataSourceBadge source={c.spendSource} className="ml-1" />}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(c.costPerLead)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(c.costPerRegistration)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(c.costPerActivatedUser)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function AccountTable({ report }: { report: AnalyticsReportDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performa akun TikTok</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Akun</TableHead>
            <TableHead className="text-right">Followers</TableHead>
            <TableHead className="text-right">Prospek</TableHead>
            <TableHead className="text-right">Pesan / balasan</TableHead>
            <TableHead className="text-right">Registrasi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.accounts.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <span className="flex items-center gap-1.5 font-medium">
                  <LaneDot lane={a.lane} /> @{a.username}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div className="tabular-nums">{formatNumber(a.followers)}</div>
                <DataSourceBadge source={a.followersSource} className="mt-0.5" />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(a.leads)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(a.messagesSent)} / {formatNumber(a.replies)}
                <span className="block text-xs text-muted-foreground">{pct(a.replyRate)}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(a.registrations)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function OperatorTable({ report }: { report: AnalyticsReportDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Produktivitas operator
        </CardTitle>
      </CardHeader>
      {!report.operators.length ? (
        <EmptyState title="Belum ada aktivitas operator" className="py-8" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Operator</TableHead>
              <TableHead className="text-right">Prospek</TableHead>
              <TableHead className="text-right">Tugas</TableHead>
              <TableHead className="text-right">Terkirim</TableHead>
              <TableHead className="text-right">Balasan</TableHead>
              <TableHead className="text-right">Daftar*</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.operators.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(o.leadsAssigned)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(o.tasksCreated)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(o.messagesSent)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(o.replies)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(o.registeredOutcomes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="px-5 py-3 text-xs text-muted-foreground">
        * Hasil tugas "Prospek mendaftar" yang dikonfirmasi operator.
      </p>
    </Card>
  );
}
