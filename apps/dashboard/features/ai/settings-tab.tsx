'use client';

import { AI_MODE_LABELS, type AiSettings } from '@smge/shared';
import type { AiStatusDto } from '@smge/types';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, FormField, TableSkeleton } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useAiSettings } from './api';

export function AiSettingsTab({ status }: { status: AiStatusDto | undefined }) {
  const q = useAiSettings();
  if (q.isPending) return <TableSkeleton rows={3} cols={2} />;
  if (q.isError) return <p className="text-sm text-destructive">{q.error.message}</p>;
  return <SettingsForm initial={q.data} status={status} />;
}

interface PriceRow {
  model: string;
  inputPer1M: string;
  outputPer1M: string;
}

function SettingsForm({
  initial,
  status,
}: {
  initial: AiSettings;
  status: AiStatusDto | undefined;
}) {
  const qc = useQueryClient();
  const [model, setModel] = useState(initial.model ?? '');
  const [budget, setBudget] = useState(initial.monthlyBudgetUsd?.toString() ?? '');
  const [prices, setPrices] = useState<PriceRow[]>(
    Object.entries(initial.pricing).map(([m, p]) => ({
      model: m,
      inputPer1M: String(p.inputPer1M),
      outputPer1M: String(p.outputPer1M),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/ai/settings', {
        model,
        mode: 'COPILOT',
        monthlyBudgetUsd: budget,
        pricing: Object.fromEntries(
          prices
            .filter((p) => p.model.trim())
            .map((p) => [
              p.model.trim(),
              { inputPer1M: p.inputPer1M || 0, outputPer1M: p.outputPer1M || 0 },
            ]),
        ),
      });
      toast.success('Pengaturan AI disimpan');
      await qc.invalidateQueries({ queryKey: ['ai'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const setPrice = (i: number, patch: Partial<PriceRow>) =>
    setPrices((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Model & mode</CardTitle>
          <CardDescription>
            Provider: {status?.provider ?? 'belum dikonfigurasi'}
            {status?.simulated && ' (simulasi)'}. API key diatur di file .env server, tidak pernah
            lewat dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormError message={error} />
          <FormField
            label="Model"
            htmlFor="ai-model"
            hint="Kosongkan untuk memakai OPENAI_MODEL dari environment. Pastikan model tersedia di akun OpenAI Anda."
          >
            <Input
              id="ai-model"
              placeholder={status?.model ?? 'mis. gpt-4o-mini'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </FormField>
          <FormField
            label="Mode"
            hint="Auto-reply resmi baru dapat diaktifkan setelah integrasi messaging TikTok tersedia dan mengizinkannya (Fase 4)."
          >
            <Select value="COPILOT" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COPILOT">{AI_MODE_LABELS.COPILOT}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Batas biaya per bulan (US$)"
            htmlFor="ai-budget"
            hint="Kosong = tanpa batas. Pemanggilan AI dihentikan saat batas tercapai."
          >
            <Input
              id="ai-budget"
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </FormField>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Harga model</CardTitle>
          <CardDescription>
            Isi dari halaman harga resmi penyedia (US$ per 1 juta token). Dipakai untuk menghitung
            biaya; tanpa harga, biaya tercatat US$0.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {prices.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
              <FormField label={i === 0 ? 'Model' : ''}>
                <Input
                  value={p.model}
                  onChange={(e) => setPrice(i, { model: e.target.value })}
                  aria-label="Nama model"
                />
              </FormField>
              <FormField label={i === 0 ? 'Input' : ''}>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={p.inputPer1M}
                  onChange={(e) => setPrice(i, { inputPer1M: e.target.value })}
                  aria-label="Harga input per 1 juta token"
                />
              </FormField>
              <FormField label={i === 0 ? 'Output' : ''}>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={p.outputPer1M}
                  onChange={(e) => setPrice(i, { outputPer1M: e.target.value })}
                  aria-label="Harga output per 1 juta token"
                />
              </FormField>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Hapus baris"
                onClick={() => setPrices((ps) => ps.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              setPrices((ps) => [
                ...ps,
                { model: model || status?.model || '', inputPer1M: '', outputPer1M: '' },
              ])
            }
          >
            <Plus /> Tambah harga model
          </Button>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 className="animate-spin" />}
          Simpan pengaturan
        </Button>
      </div>
    </div>
  );
}
