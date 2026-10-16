'use client';

import { AI_INTERACTION_TYPE_LABELS, type AiInteractionType } from '@smge/shared';
import type { AiStatusDto } from '@smge/types';
import { Activity, AlertTriangle, Coins, FlaskConical, Hash } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, Pagination, StatCard, TableSkeleton } from '@/components/common';
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
import { formatDateTime, formatNumber } from '@/lib/utils';
import { formatUsd } from './ai-common';
import { useAiInteractions, useAiUsage } from './api';

const RANGES = [7, 30, 90];

export function UsageTab({ status }: { status: AiStatusDto | undefined }) {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const q = useAiUsage(days);
  const log = useAiInteractions(page);
  const u = q.data;
  const budgetUsed = status?.monthlyBudgetUsd
    ? Math.min(100, (status.spentThisMonthUsd / status.monthlyBudgetUsd) * 100)
    : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={days === r ? 'secondary' : 'ghost'}
            onClick={() => setDays(r)}
          >
            {r} hari
          </Button>
        ))}
        {status && !status.priceConfigured && status.configured && !status.simulated && (
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3.5" /> Harga model belum diatur — biaya tercatat US$0.
            Atur di tab Pengaturan.
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Interaksi AI"
          icon={Activity}
          loading={q.isPending}
          value={formatNumber(u?.totals.interactions ?? 0)}
          hint={
            u && (
              <span>
                {formatNumber(u.totals.failed)} gagal · {formatNumber(u.totals.blocked)} diblokir
              </span>
            )
          }
        />
        <StatCard
          label="Token"
          icon={Hash}
          loading={q.isPending}
          value={formatNumber((u?.totals.promptTokens ?? 0) + (u?.totals.completionTokens ?? 0))}
          hint={
            u && (
              <span>
                {formatNumber(u.totals.promptTokens)} input ·{' '}
                {formatNumber(u.totals.completionTokens)} output
              </span>
            )
          }
        />
        <StatCard
          label={`Biaya ${days} hari`}
          icon={Coins}
          loading={q.isPending}
          value={formatUsd(u?.totals.costUsd ?? 0)}
        />
        <StatCard
          label="Biaya bulan ini"
          icon={Coins}
          loading={!status}
          value={formatUsd(status?.spentThisMonthUsd ?? 0)}
          hint={
            status?.monthlyBudgetUsd ? (
              <span className="flex w-full flex-col gap-1">
                dari batas {formatUsd(status.monthlyBudgetUsd)}
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${budgetUsed! >= 90 ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${budgetUsed}%` }}
                  />
                </span>
              </span>
            ) : (
              'Tanpa batas bulanan'
            )
          }
        />
      </div>
      {u && u.totals.simulated > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FlaskConical className="size-3.5" /> {formatNumber(u.totals.simulated)} interaksi
          simulasi tidak dihitung dalam angka di atas.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Interaksi AI per hari</CardTitle>
            <CardDescription>Tidak termasuk simulasi</CardDescription>
          </CardHeader>
          <CardContent>
            {q.isPending ? (
              <Skeleton className="h-60" />
            ) : !u || u.totals.interactions === 0 ? (
              <EmptyState icon={Activity} title="Belum ada pemakaian AI" className="py-10" />
            ) : (
              <div className="h-60" role="img" aria-label="Grafik jumlah interaksi AI per hari">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={u.byDay} margin={{ left: -16, right: 8, top: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={12}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload as (typeof u.byDay)[number];
                        return (
                          <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                            <p className="font-medium">
                              {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
                                new Date(d.date),
                              )}
                            </p>
                            <p>{formatNumber(d.interactions)} interaksi</p>
                            <p>
                              {formatNumber(d.tokens)} token · {formatUsd(d.costUsd)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="interactions"
                      fill="var(--chart-1)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Per fitur</CardTitle>
          </CardHeader>
          <CardContent>
            {!u?.byType.length ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {u.byType.map((t) => (
                  <li key={t.type} className="flex justify-between gap-2">
                    <span>{AI_INTERACTION_TYPE_LABELS[t.type as AiInteractionType] ?? t.type}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatNumber(t.interactions)} · {formatUsd(t.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {u && u.byModel.length > 0 && (
              <>
                <p className="mt-4 mb-2 text-xs font-medium text-muted-foreground uppercase">
                  Per model
                </p>
                <ul className="grid gap-2 text-sm">
                  {u.byModel.map((m) => (
                    <li key={m.model} className="flex justify-between gap-2">
                      <span className="truncate font-mono text-xs">{m.model}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatNumber(m.tokens)} token
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Log interaksi</CardTitle>
          <CardDescription>
            Setiap pemanggilan AI tercatat, termasuk yang gagal atau diblokir guardrail.
          </CardDescription>
        </CardHeader>
        {log.isPending ? (
          <TableSkeleton cols={5} />
        ) : !log.data?.items.length ? (
          <EmptyState title="Belum ada interaksi" className="py-8" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Waktu</TableHead>
                  <TableHead>Fitur</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pengguna</TableHead>
                  <TableHead className="text-right">Token</TableHead>
                  <TableHead className="text-right">Biaya</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {AI_INTERACTION_TYPE_LABELS[r.type as AiInteractionType] ?? r.type}
                      {r.simulated && (
                        <Badge variant="simulation" className="ml-1">
                          Simulasi
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === 'SUCCESS'
                            ? 'success'
                            : r.status === 'BLOCKED'
                              ? 'warning'
                              : 'destructive'
                        }
                      >
                        {{ SUCCESS: 'Berhasil', FAILED: 'Gagal', BLOCKED: 'Diblokir' }[r.status]}
                      </Badge>
                      {r.errorMessage && (
                        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                          {r.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.user?.name ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatNumber(r.promptTokens + r.completionTokens)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.simulated ? '—' : formatUsd(r.costUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={log.data.page}
              totalPages={log.data.totalPages}
              total={log.data.total}
              pageSize={log.data.pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
