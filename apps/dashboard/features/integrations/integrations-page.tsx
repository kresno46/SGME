'use client';

import { INTEGRATION_PROVIDER_LABELS, PERMISSIONS } from '@smge/shared';
import type { CapabilityStatus, ConnectedAccountDto, IntegrationsOverviewDto } from '@smge/types';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Copy,
  FlaskConical,
  Link2,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  Unplug,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { LaneBadge, IntegrationBadge } from '@/features/accounts/status-badges';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/utils';
import {
  useConnect,
  useDisconnect,
  useIntegrationLogs,
  useIntegrationsOverview,
  useSync,
} from './api';

const CAP_STATUS: Record<
  CapabilityStatus,
  {
    label: string;
    variant: 'success' | 'secondary' | 'simulation' | 'warning';
    Icon: typeof CheckCircle2;
  }
> = {
  READY: { label: 'Siap', variant: 'success', Icon: CheckCircle2 },
  NOT_CONFIGURED: { label: 'Belum dikonfigurasi', variant: 'secondary', Icon: CircleDashed },
  SIMULATION: { label: 'Simulasi', variant: 'simulation', Icon: FlaskConical },
  NOT_VERIFIED: { label: 'Menunggu verifikasi', variant: 'warning', Icon: ShieldQuestion },
};

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value}</code>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Salin ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success('Disalin');
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const q = useIntegrationsOverview();
  const error = params.get('error');
  const connected = params.get('connected');
  const notified = useRef(false);

  // Hasil redirect OAuth: tampilkan sekali lalu bersihkan URL
  useEffect(() => {
    if (notified.current || (!error && !connected)) return;
    notified.current = true;
    if (connected) toast.success('Akun TikTok berhasil dihubungkan');
    if (!error) router.replace('/integrations', { scroll: false });
  }, [connected, error, router]);

  return (
    <>
      <PageHeader
        title="Integrasi"
        description="Koneksi resmi ke TikTok. Hanya endpoint yang telah diverifikasi dari dokumentasi resmi yang diaktifkan."
      />
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
          <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="flex-1">
            <strong>Gagal menghubungkan akun.</strong> {error}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.replace('/integrations', { scroll: false })}
          >
            Tutup
          </Button>
        </div>
      )}
      {q.isPending ? (
        <TableSkeleton />
      ) : q.isError ? (
        <EmptyState title="Gagal memuat integrasi" description={q.error.message} />
      ) : (
        <div className="grid gap-6">
          <Capabilities data={q.data} />
          <Accounts data={q.data} />
          <Logs />
        </div>
      )}
    </>
  );
}

function Capabilities({ data }: { data: IntegrationsOverviewDto }) {
  const { can } = useAuth();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        {data.capabilities.map((c) => {
          const s = CAP_STATUS[c.status];
          return (
            <Card key={c.key} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{c.name}</p>
                <Badge variant={s.variant}>
                  <s.Icon /> {s.label}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
              {c.missing.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {c.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Konfigurasi di portal TikTok</CardTitle>
          <CardDescription>
            Daftarkan nilai berikut di developers.tiktok.com → aplikasi Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.callbackUrl ? (
            <CopyValue label="Redirect URI (Login Kit)" value={data.callbackUrl} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Redirect URI belum diatur (TIKTOK_REDIRECT_URI). Formatnya:
              https://&lt;domain&gt;/api/integrations/tiktok/callback
            </p>
          )}
          <CopyValue label="Webhook Callback URL" value={data.webhookUrl} />
          <div>
            <p className="text-xs text-muted-foreground">Scope yang diminta</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {data.scopes.map((s) => (
                <Badge key={s} variant="outline" className="font-mono">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Client key & secret diisi di file .env server — tidak pernah lewat dashboard.
            {!can(PERMISSIONS.INTEGRATIONS_MANAGE) && ' Anda hanya dapat melihat halaman ini.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Accounts({ data }: { data: IntegrationsOverviewDto }) {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.INTEGRATIONS_MANAGE);
  const connect = useConnect();
  const sync = useSync();
  const disconnect = useDisconnect();
  const [disconnecting, setDisconnecting] = useState<{ id: string; username: string } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Akun TikTok</CardTitle>
        <CardDescription>
          Hubungkan lewat OAuth resmi. Pemilik akun login di TikTok dan menyetujui akses — SMGE
          tidak pernah meminta password TikTok. Akun yang diotorisasi harus sama dengan akun yang
          dipilih.
        </CardDescription>
      </CardHeader>
      {!data.accounts.length ? (
        <EmptyState
          title="Belum ada akun TikTok"
          action={
            <Button asChild variant="outline">
              <Link href="/accounts">Tambah akun</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Akun</TableHead>
              <TableHead className="text-right">Followers</TableHead>
              <TableHead>Koneksi</TableHead>
              <TableHead>Sinkron terakhir</TableHead>
              <TableHead className="w-72">
                <span className="sr-only">Aksi</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.accounts.map((row) => (
              <AccountRow
                key={row.account.id}
                row={row}
                canManage={canManage}
                providers={data.connectProviders}
                busy={connect.isPending || sync.isPending}
                onConnect={(provider) => connect.mutate({ accountId: row.account.id, provider })}
                onSync={(id) =>
                  sync.mutate(id, {
                    onSuccess: (r) =>
                      r.status === 'CONNECTED' ? toast.success(r.message) : toast.error(r.message),
                  })
                }
                onDisconnect={(id) => setDisconnecting({ id, username: row.account.username })}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!disconnecting}
        onOpenChange={(o) => !o && setDisconnecting(null)}
        destructive
        title="Putuskan koneksi?"
        description={`Akses SMGE ke @${disconnecting?.username} dicabut dan token dihapus. Data akun di SMGE tetap tersimpan.`}
        confirmLabel="Putuskan"
        onConfirm={async () => {
          await disconnect.mutateAsync(disconnecting!.id);
          toast.success('Koneksi diputus');
        }}
      />
    </Card>
  );
}

function AccountRow({
  row,
  canManage,
  providers,
  busy,
  onConnect,
  onSync,
  onDisconnect,
}: {
  row: ConnectedAccountDto;
  canManage: boolean;
  providers: Array<'TIKTOK_LOGIN_KIT' | 'MOCK'>;
  busy: boolean;
  onConnect: (p: 'TIKTOK_LOGIN_KIT' | 'MOCK') => void;
  onSync: (integrationId: string) => void;
  onDisconnect: (integrationId: string) => void;
}) {
  const active = row.integrations.filter(
    (i) => i.status !== 'REVOKED' && i.status !== 'NOT_CONNECTED',
  );
  const revoked = row.integrations.filter((i) => i.status === 'REVOKED' && i.lastError);
  return (
    <TableRow>
      <TableCell>
        <Link href={`/accounts/${row.account.id}`} className="font-medium hover:underline">
          @{row.account.username}
        </Link>
        <div className="mt-1">
          <LaneBadge lane={row.account.lane} />
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="tabular-nums">{formatNumber(row.account.followersCount)}</div>
        <DataSourceBadge source={row.account.followersSource} className="mt-0.5" />
      </TableCell>
      <TableCell>
        {active.length === 0 ? (
          <>
            <IntegrationBadge status="NOT_CONNECTED" />
            {revoked[0] && (
              <p className="mt-1 max-w-56 text-xs text-muted-foreground">{revoked[0].lastError}</p>
            )}
          </>
        ) : (
          <div className="grid gap-1">
            {active.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-1">
                <IntegrationBadge status={i.status} />
                {i.isSimulation && <Badge variant="simulation">Simulasi</Badge>}
                <span className="text-xs text-muted-foreground">
                  {INTEGRATION_PROVIDER_LABELS[i.provider]}
                </span>
                {i.lastError && (
                  <p className="flex w-full items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3" /> {i.lastError}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatRelative(row.account.lastSyncedAt)}
        {active[0]?.tokenExpiresAt && (
          <span className="block text-xs">
            Token s.d. {formatDateTime(active[0].tokenExpiresAt)}
          </span>
        )}
      </TableCell>
      <TableCell>
        {canManage && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {active.map((i) => (
              <span key={i.id} className="flex gap-1.5">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onSync(i.id)}>
                  <RefreshCw /> Sinkron
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDisconnect(i.id)}
                  aria-label="Putuskan koneksi"
                >
                  <Unplug />
                </Button>
              </span>
            ))}
            {active.length === 0 &&
              providers.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === 'MOCK' ? 'outline' : 'default'}
                  disabled={busy}
                  onClick={() => onConnect(p)}
                >
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : p === 'MOCK' ? (
                    <FlaskConical />
                  ) : (
                    <Link2 />
                  )}
                  {p === 'MOCK' ? 'Hubungkan (simulasi)' : 'Hubungkan'}
                </Button>
              ))}
            {active.length === 0 && providers.length === 0 && (
              <span className="text-xs text-muted-foreground">Login Kit belum dikonfigurasi</span>
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function Logs() {
  const [page, setPage] = useState(1);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const q = useIntegrationLogs(page, onlyErrors);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Log integrasi</CardTitle>
          <CardDescription>
            Panggilan ke TikTok, callback OAuth, dan webhook. Token & secret selalu disensor.
          </CardDescription>
        </div>
        <Label className="font-normal">
          <Checkbox
            checked={onlyErrors}
            onChange={(e) => {
              setOnlyErrors(e.target.checked);
              setPage(1);
            }}
          />
          Hanya error
        </Label>
      </CardHeader>
      {q.isPending ? (
        <TableSkeleton cols={5} />
      ) : !q.data?.items.length ? (
        <EmptyState title="Belum ada log" className="py-8" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Waktu</TableHead>
                <TableHead>Operasi</TableHead>
                <TableHead>Arah</TableHead>
                <TableHead>Hasil</TableHead>
                <TableHead className="text-right">Durasi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <code className="text-xs">{l.operation}</code>
                    {l.isSimulation && (
                      <Badge variant="simulation" className="ml-1">
                        Simulasi
                      </Badge>
                    )}
                    {l.message && <p className="text-xs text-muted-foreground">{l.message}</p>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {
                      {
                        OUTBOUND_REQUEST: 'Ke TikTok',
                        INBOUND_WEBHOOK: 'Dari TikTok',
                        INTERNAL: 'Internal',
                      }[l.direction]
                    }
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        l.success ? 'success' : l.level === 'WARN' ? 'warning' : 'destructive'
                      }
                    >
                      {l.success ? 'Berhasil' : 'Gagal'}
                      {l.statusCode !== null && ` · ${l.statusCode}`}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {l.durationMs !== null ? `${l.durationMs} ms` : '—'}
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
  );
}
