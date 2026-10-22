'use client';

import { LEAD_IMPORT_COLUMNS } from '@smge/shared';
import type { LeadImportPreviewDto, LeadImportResultDto } from '@smge/types';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/common';
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
} from '@/components/ui/overlays';
import {
  Badge,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useCampaignOptions } from '@/hooks/use-lookups';
import { api, ApiError } from '@/lib/api';
import { HIDE_OFFICIAL_LANE } from '@/lib/marketing-scope';
import { formatNumber } from '@/lib/utils';
import { useInvalidateLeads } from './api';

const NONE = '__none__';

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import prospek dari CSV</DialogTitle>
          <DialogDescription>
            Hanya untuk data yang diperoleh secara sah — misalnya formulir pendaftaran atau acara.
            Untuk hasil collector followers, gunakan Ambil followers di Outbound Workstation.
          </DialogDescription>
        </DialogHeader>
        <ImportWizard onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ImportWizard({ onDone }: { onDone: () => void }) {
  const invalidate = useInvalidateLeads();
  const campaigns = useCampaignOptions();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LeadImportPreviewDto | null>(null);
  const [result, setResult] = useState<LeadImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceDescription, setSourceDescription] = useState('');
  const [campaignId, setCampaignId] = useState(NONE);
  const [tags, setTags] = useState('');
  const [strategy, setStrategy] = useState<'skip' | 'update_empty'>('skip');
  const [confirmed, setConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const runPreview = async (f: File) => {
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      setPreview(await api.upload<LeadImportPreviewDto>('/leads/import/preview', form));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membaca file');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file) return;
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('sourceDescription', sourceDescription);
      form.append('lawfulBasisConfirmed', String(confirmed));
      form.append('duplicateStrategy', strategy);
      if (tags) form.append('tags', tags);
      if (campaignId !== NONE) form.append('sourceCampaignId', campaignId);
      const r = await api.upload<LeadImportResultDto>('/leads/import', form);
      setResult(r);
      toast.success(`${formatNumber(r.created)} prospek diimpor`);
      await invalidate();
    } catch (e) {
      if (e instanceof ApiError && e.errors) setFieldErrors(e.errors);
      setError(e instanceof Error ? e.message : 'Import gagal');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="grid gap-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          {[
            ['Dibuat', result.created],
            ['Dilengkapi', result.updated],
            ['Dilewati (duplikat)', result.skipped],
            ['Diblokir (DNC)', result.blocked],
            ['Tidak valid', result.invalid],
          ].map(([l, v]) => (
            <div key={l} className="rounded-md border p-2">
              <p className="text-xl font-semibold tabular-nums">{formatNumber(v as number)}</p>
              <p className="text-xs text-muted-foreground">{l}</p>
            </div>
          ))}
        </div>
        <Button onClick={onDone}>Selesai</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <div className="rounded-md border border-dashed p-4">
        <Label
          htmlFor="csv"
          className="flex cursor-pointer flex-col items-center gap-2 text-center font-normal"
        >
          <FileUp className="size-6 text-muted-foreground" />
          <span className="font-medium">
            {file ? file.name : 'Pilih file CSV (maks. 5 MB, 5.000 baris)'}
          </span>
          <span className="text-xs text-muted-foreground">
            Kolom dikenali:{' '}
            {Object.values(LEAD_IMPORT_COLUMNS)
              .map((a) => a[0])
              .join(', ')}
            . Pemisah koma atau titik koma.
          </span>
        </Label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) void runPreview(f);
          }}
        />
      </div>

      {busy && !preview && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Memeriksa file…
        </p>
      )}

      {preview && (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="success">{formatNumber(preview.newLeads)} baru</Badge>
            <Badge variant="secondary">{formatNumber(preview.duplicates)} duplikat</Badge>
            <Badge variant="destructive">{formatNumber(preview.blocked)} di daftar larangan</Badge>
            <Badge variant="warning">{formatNumber(preview.invalid.length)} tidak valid</Badge>
            <span className="text-muted-foreground">
              dari {formatNumber(preview.totalRows)} baris
            </span>
          </div>
          {preview.invalid.length > 0 && (
            <ul className="max-h-24 overflow-y-auto rounded-md bg-warning/10 p-2 text-xs">
              {preview.invalid.map((i) => (
                <li key={i.row}>
                  Baris {i.row}: {i.message}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-48 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Baris</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kontak</TableHead>
                  <TableHead>Hasil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sample.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="text-xs">{r.row}</TableCell>
                    <TableCell className="text-sm">{r.name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        r.tiktokUsername && `@${r.tiktokUsername.replace(/^@/, '')}`,
                        r.email,
                        r.phone,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === 'new'
                            ? 'success'
                            : r.status === 'blocked'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {{ new: 'Baru', duplicate: 'Duplikat', blocked: 'Diblokir' }[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <FormField
            label="Asal data"
            htmlFor="imp-src"
            error={fieldErrors.sourceDescription?.[0]}
            hint='Wajib. Contoh: "Form pendaftaran webinar Solid Mini 10 Oktober 2026"'
          >
            <Input
              id="imp-src"
              value={sourceDescription}
              onChange={(e) => setSourceDescription(e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            {!HIDE_OFFICIAL_LANE && (
              <FormField label="Campaign sumber">
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Tidak ada</SelectItem>
                    {campaigns.data?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Tag tambahan" htmlFor="imp-tags">
              <Input
                id="imp-tags"
                placeholder="mis. webinar-okt"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </FormField>
            <FormField label="Data duplikat">
              <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Lewati</SelectItem>
                  <SelectItem value="update_empty">Lengkapi kolom kosong</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <Label className="items-start gap-3 rounded-md border p-3 font-normal leading-snug">
            <Checkbox
              className="mt-0.5"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              Saya menyatakan data ini diperoleh secara sah dan pemiliknya menyetujui dihubungi
              melalui kanal yang ditandai pada kolom izin (izin_whatsapp / izin_email).
              {fieldErrors.lawfulBasisConfirmed && (
                <span className="mt-1 block text-xs text-destructive">
                  {fieldErrors.lawfulBasisConfirmed[0]}
                </span>
              )}
            </span>
          </Label>
        </>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button disabled={!preview || busy || !confirmed} onClick={() => void commit()}>
          {busy && preview && <Loader2 className="animate-spin" />}
          Import {preview ? formatNumber(preview.newLeads) : ''} prospek
        </Button>
      </DialogFooter>
    </div>
  );
}
