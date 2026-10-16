'use client';

import { CAMPAIGN_TYPE_LABELS, LANE_LABELS, PERMISSIONS } from '@smge/shared';
import { ArrowLeft, Copy, Pencil, Send, Sparkles, UserCheck, UserPlus, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataSourceBadge, EmptyState, StatCard } from '@/components/common';
import { CampaignStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { LaneBadge } from '@/features/accounts/status-badges';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { useCampaign } from './api';
import { CampaignFormDialog } from './campaign-form-dialog';
import { formatPeriod, formatRupiah } from './campaigns-page';

export function CampaignDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const q = useCampaign(id);
  const [editOpen, setEditOpen] = useState(false);

  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <EmptyState
        title="Campaign tidak dapat dimuat"
        description={q.error.message}
        action={
          <Button asChild variant="outline">
            <Link href="/campaigns">Kembali</Link>
          </Button>
        }
      />
    );
  }
  const c = q.data;
  const budgetUsed =
    c.budget && Number(c.budget) > 0
      ? Math.min(100, (Number(c.spend) / Number(c.budget)) * 100)
      : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link href="/campaigns">
          <ArrowLeft /> Semua campaign
        </Link>
      </Button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <LaneBadge lane={c.lane} />
            <CampaignStatusBadge status={c.status} />
            <span className="text-sm text-muted-foreground">
              {CAMPAIGN_TYPE_LABELS[c.type]} · {formatPeriod(c)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/leads?sourceCampaignId=${c.id}`}>
              <UserPlus /> Lihat prospek
            </Link>
          </Button>
          {can(PERMISSIONS.CAMPAIGNS_MANAGE) && (
            <Button onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Prospek"
          icon={UserPlus}
          value={formatNumber(c.stats.leads)}
          hint="Data simulasi tidak dihitung"
        />
        <StatCard
          label="Prospek tertarik"
          icon={Sparkles}
          value={formatNumber(c.stats.interestedLeads)}
        />
        <StatCard
          label="Terdaftar"
          icon={UserCheck}
          value={formatNumber(c.stats.registeredLeads)}
          hint="Dikonfirmasi operator; verifikasi otomatis di Fase 5"
        />
        <StatCard label="Tugas outbound" icon={Send} value={formatNumber(c.stats.outreachTasks)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Jalur</dt>
              <dd>{LANE_LABELS[c.lane]}</dd>
              <dt className="text-muted-foreground">Kode tracking</dt>
              <dd className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.trackingCode}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Salin kode tracking"
                  onClick={() => {
                    void navigator.clipboard.writeText(c.trackingCode);
                    toast.success('Kode tracking disalin');
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </dd>
              <dt className="text-muted-foreground">Operator</dt>
              <dd>{c.operator?.name ?? '—'}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd>{c.target ?? '—'}</dd>
              <dt className="text-muted-foreground">Deskripsi</dt>
              <dd className="whitespace-pre-wrap">{c.description ?? '—'}</dd>
              <dt className="text-muted-foreground">Diperbarui</dt>
              <dd>{formatDateTime(c.updatedAt)}</dd>
            </dl>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Anggaran</CardTitle>
              <Wallet className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Anggaran</span>
                <span className="font-medium tabular-nums">{formatRupiah(c.budget)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Biaya aktual</span>
                <span className="flex items-center gap-2 font-medium tabular-nums">
                  {formatRupiah(c.spend)} <DataSourceBadge source={c.spendSource} />
                </span>
              </div>
              {budgetUsed !== null && (
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                  aria-label={`${Math.round(budgetUsed)}% anggaran terpakai`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${budgetUsed}%` }}
                  />
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Biaya per lead</span>
                <span className="font-medium tabular-nums">
                  {formatRupiah(c.stats.costPerLead)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Akun TikTok</CardTitle>
            </CardHeader>
            <CardContent>
              {c.accounts.length ? (
                <ul className="flex flex-wrap gap-2">
                  {c.accounts.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/accounts/${a.id}`}
                        className="rounded-md border px-2 py-1 text-sm hover:bg-muted"
                      >
                        @{a.username}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada akun yang ditugaskan.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <CampaignFormDialog open={editOpen} onOpenChange={setEditOpen} campaign={c} />
    </>
  );
}
