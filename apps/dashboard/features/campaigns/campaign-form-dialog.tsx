'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPE_LABELS,
  CAMPAIGN_TYPES,
  createCampaignSchema,
  LANE_LABELS,
  type CreateCampaignInput,
} from '@smge/shared';
import type { CampaignDto } from '@smge/types';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
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
import { Checkbox, Input, Label, Textarea } from '@/components/ui/primitives';
import { useAccountOptions, useAssignableUsers } from '@/hooks/use-lookups';
import { applyServerErrors } from '@/lib/api';
import { HIDE_OFFICIAL_LANE, VISIBLE_MARKETING_LANES } from '@/lib/marketing-scope';
import { formatNumber } from '@/lib/utils';
import { useSaveCampaign } from './api';

type FormInput = z.input<typeof createCampaignSchema>;
type FormOutput = z.output<typeof createCampaignSchema>;
const NONE = '__none__';

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function toForm(c?: CampaignDto | null): FormInput {
  return {
    name: c?.name ?? '',
    lane: c?.lane ?? 'OUTBOUND',
    type: c?.type ?? 'LEAD_ACQUISITION',
    status: c?.status ?? 'DRAFT',
    target: c?.target ?? '',
    description: c?.description ?? '',
    startDate: dateInput(c?.startDate ?? null),
    endDate: dateInput(c?.endDate ?? null),
    budget: c?.budget ? Number(c.budget) : '',
    spend: c ? Number(c.spend) : 0,
    operatorId: c?.operator?.id ?? '',
    accountIds: c?.accounts.map((a) => a.id) ?? [],
  };
}

export function CampaignFormDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign?: CampaignDto | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign ? 'Edit campaign' : 'Buat campaign'}</DialogTitle>
          <DialogDescription>
            Kode tracking unik dibuat otomatis. Biaya aktual diisi manual sampai Ads Reporting
            terhubung (Fase 4–5).
          </DialogDescription>
        </DialogHeader>
        <CampaignForm campaign={campaign} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CampaignForm({ campaign, onDone }: { campaign?: CampaignDto | null; onDone: () => void }) {
  const save = useSaveCampaign();
  const users = useAssignableUsers();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: toForm(campaign),
  });
  const { errors, isSubmitting } = form.formState;
  const lane = useWatch({ control: form.control, name: 'lane' });
  const accounts = useAccountOptions(lane);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync({ id: campaign?.id, data: values as unknown as CreateCampaignInput });
      toast.success(campaign ? 'Campaign diperbarui' : 'Campaign dibuat');
      onDone();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  const select = <K extends 'lane' | 'type' | 'status'>(
    name: K,
    options: readonly string[],
    labels: Record<string, string>,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value as string}
          onValueChange={(v) => {
            field.onChange(v);
            if (name === 'lane') form.setValue('accountIds', []);
          }}
        >
          <SelectTrigger aria-invalid={!!errors[name]}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {labels[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      <FormField label="Nama campaign" htmlFor="c-name" error={errors.name?.message}>
        <Input id="c-name" aria-invalid={!!errors.name} {...form.register('name')} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        {!HIDE_OFFICIAL_LANE && (
          <FormField label="Jalur" error={errors.lane?.message}>
            {select('lane', VISIBLE_MARKETING_LANES, LANE_LABELS)}
          </FormField>
        )}
        <FormField label="Jenis" error={errors.type?.message}>
          {select('type', CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABELS)}
        </FormField>
        <FormField label="Status" error={errors.status?.message}>
          {select('status', CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS)}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tanggal mulai" htmlFor="c-start" error={errors.startDate?.message}>
          <Input id="c-start" type="date" {...form.register('startDate')} />
        </FormField>
        <FormField label="Tanggal selesai" htmlFor="c-end" error={errors.endDate?.message}>
          <Input id="c-end" type="date" {...form.register('endDate')} />
        </FormField>
        <FormField label="Anggaran (Rp)" htmlFor="c-budget" error={errors.budget?.message}>
          <Input
            id="c-budget"
            type="number"
            min={0}
            inputMode="numeric"
            {...form.register('budget')}
          />
        </FormField>
        <FormField
          label="Biaya aktual (Rp)"
          htmlFor="c-spend"
          error={errors.spend?.message}
          hint="Ditandai sebagai input manual"
        >
          <Input
            id="c-spend"
            type="number"
            min={0}
            inputMode="numeric"
            {...form.register('spend')}
          />
        </FormField>
      </div>
      <FormField label="Operator penanggung jawab" error={errors.operatorId?.message}>
        <Controller
          control={form.control}
          name="operatorId"
          render={({ field }) => (
            <Select
              value={(field.value as string) || NONE}
              onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Belum ditentukan</SelectItem>
                {users.data?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      <FormField
        label={
          HIDE_OFFICIAL_LANE
            ? 'Akun TikTok pengirim'
            : `Akun TikTok (${lane === 'OFFICIAL' ? 'Jalur A' : 'Jalur B'})`
        }
        error={errors.accountIds?.message}
      >
        <Controller
          control={form.control}
          name="accountIds"
          render={({ field }) => {
            const value = (field.value as string[]) ?? [];
            return accounts.data?.length ? (
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {accounts.data.map((a) => (
                  <Label
                    key={a.id}
                    className="cursor-pointer rounded px-2 py-1.5 font-normal hover:bg-muted"
                  >
                    <Checkbox
                      checked={value.includes(a.id)}
                      onChange={(e) =>
                        field.onChange(
                          e.target.checked ? [...value, a.id] : value.filter((v) => v !== a.id),
                        )
                      }
                    />
                    <span className="truncate">@{a.username}</span>
                    {a.isVerified && <BadgeCheck className="size-3.5 text-brand-text" />}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatNumber(a.followersCount)}
                    </span>
                  </Label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Belum ada akun TikTok di jalur ini.
              </p>
            );
          }}
        />
      </FormField>

      <FormField label="Target pemasaran" htmlFor="c-target" error={errors.target?.message}>
        <Input
          id="c-target"
          placeholder="mis. Followers 18–35 tahun yang tertarik investasi"
          {...form.register('target')}
        />
      </FormField>
      <FormField label="Deskripsi" htmlFor="c-desc" error={errors.description?.message}>
        <Textarea id="c-desc" rows={3} {...form.register('description')} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {campaign ? 'Simpan perubahan' : 'Buat campaign'}
        </Button>
      </DialogFooter>
    </form>
  );
}
