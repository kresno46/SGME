'use client';

import { PERMISSIONS } from '@smge/shared';
import type { CampaignDto, TrackingLinkDto } from '@smge/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, FormError, FormField } from '@/components/common';
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
  Switch,
} from '@/components/ui/overlays';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

const NONE = '__none__';

export function TrackingLinksCard({ campaign }: { campaign: CampaignDto }) {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.CAMPAIGNS_MANAGE);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['campaigns', campaign.id, 'links'],
    queryFn: () => api.get<TrackingLinkDto[]>(`/campaigns/${campaign.id}/tracking-links`),
  });
  const toggle = useMutation({
    mutationFn: (l: TrackingLinkDto) =>
      api.patch(`/tracking-links/${l.id}`, { isActive: !l.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', campaign.id, 'links'] }),
  });

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> Link tracking
          </CardTitle>
          <CardDescription>
            Bagikan link pendek di bio, video, atau DM. Klik dicatat sebagai kunjungan (tidak
            terverifikasi); registrasi dihitung dari backend Solid Mini.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Buat link
          </Button>
        )}
      </CardHeader>
      {!q.data?.length ? (
        <EmptyState icon={Link2} title="Belum ada link tracking" className="py-8" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Link</TableHead>
              <TableHead>Akun</TableHead>
              <TableHead className="text-right">Klik</TableHead>
              <TableHead className="text-right">Pengunjung</TableHead>
              <TableHead className="text-right">Registrasi</TableHead>
              <TableHead>Aktif</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <p className="font-medium">{l.name ?? l.code}</p>
                  <div className="flex items-center gap-1">
                    <code className="max-w-64 truncate text-xs text-muted-foreground">
                      {l.shortUrl}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Salin link"
                      onClick={() => {
                        void navigator.clipboard.writeText(l.shortUrl);
                        toast.success('Link disalin');
                      }}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                  <p
                    className="max-w-72 truncate text-xs text-muted-foreground"
                    title={l.destinationUrl}
                  >
                    → {l.destinationUrl}
                  </p>
                </TableCell>
                <TableCell className="text-sm">
                  {l.account ? `@${l.account.username}` : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(l.stats.clicks)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(l.stats.uniqueVisitors)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(l.stats.registrations)}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={l.isActive}
                    disabled={!canManage || toggle.isPending}
                    onCheckedChange={() => toggle.mutate(l)}
                    aria-label="Aktifkan link"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buat link tracking</DialogTitle>
            <DialogDescription>
              UTM diisi otomatis dari campaign ({campaign.trackingCode}) dan akun.
            </DialogDescription>
          </DialogHeader>
          {open && <LinkForm campaign={campaign} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LinkForm({ campaign, onDone }: { campaign: CampaignDto; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [accountId, setAccountId] = useState(campaign.accounts[0]?.id ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <FormField
        label="Nama (internal)"
        htmlFor="tl-name"
        hint='mis. "Bio @akun_b" atau "Video 12 Okt"'
      >
        <Input id="tl-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField
        label="URL tujuan"
        htmlFor="tl-dest"
        hint="Halaman registrasi / landing page Solid Mini"
      >
        <Input
          id="tl-dest"
          placeholder="https://…"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
        />
      </FormField>
      <FormField label="Akun TikTok">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Tanpa akun tertentu</SelectItem>
            {campaign.accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                @{a.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button
          disabled={busy || !destinationUrl}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.post(`/campaigns/${campaign.id}/tracking-links`, {
                name,
                destinationUrl,
                tiktokAccountId: accountId === NONE ? null : accountId,
              });
              toast.success('Link dibuat');
              await qc.invalidateQueries({ queryKey: ['campaigns', campaign.id, 'links'] });
              onDone();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Gagal membuat link');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="animate-spin" />}
          Buat link
        </Button>
      </DialogFooter>
    </div>
  );
}
