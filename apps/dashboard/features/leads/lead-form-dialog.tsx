'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CONSENT_SOURCE_LABELS,
  CONSENT_SOURCES,
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  createLeadSchema,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVELS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
} from '@smge/shared';
import type { DuplicateLeadDto, LeadDetailDto } from '@smge/types';
import { AlertTriangle, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, type Control, type FieldPath } from 'react-hook-form';
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
import { Input, Textarea } from '@/components/ui/primitives';
import { useAccountOptions, useAssignableUsers, useCampaignOptions } from '@/hooks/use-lookups';
import { api, ApiError, applyServerErrors } from '@/lib/api';
import { HIDE_OFFICIAL_LANE } from '@/lib/marketing-scope';
import { toDateTimeLocal } from '@/lib/utils';
import { useInvalidateLeads } from './api';

type FormInput = z.input<typeof createLeadSchema> & { tagsText?: string };
type FormOutput = z.output<typeof createLeadSchema>;
const NONE = '__none__';

function toForm(l?: LeadDetailDto | null): FormInput {
  return {
    name: l?.name ?? '',
    tiktokUsername: l?.tiktokUsername ?? '',
    email: l?.email ?? '',
    phone: l?.phone ?? '',
    source: l?.source ?? 'MANUAL',
    sourceAccountId: l?.sourceAccount?.id ?? '',
    sourceCampaignId: l?.sourceCampaign?.id ?? '',
    interestLevel: l?.interestLevel ?? 'UNKNOWN',
    operatorId: l?.operator?.id ?? '',
    notes: l?.notes ?? '',
    tags: l?.tags ?? [],
    tagsText: l?.tags.join(', ') ?? '',
    nextFollowUpAt: toDateTimeLocal(l?.nextFollowUpAt),
    consents: [],
  };
}

/** Select dengan opsi "kosong" untuk field UUID opsional. */
function OptionalSelect<T extends FormInput>({
  control,
  name,
  placeholder,
  options,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={(field.value as string) || NONE}
          onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{placeholder}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead?: LeadDetailDto | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? 'Edit prospek' : 'Tambah prospek'}</DialogTitle>
          <DialogDescription>
            Hanya masukkan data yang diperoleh secara sah (form, percakapan, atau diberikan
            sukarela). Mengikuti akun TikTok bukan persetujuan menerima promosi.
          </DialogDescription>
        </DialogHeader>
        <LeadForm lead={lead} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LeadForm({ lead, onDone }: { lead?: LeadDetailDto | null; onDone: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidateLeads();
  const accounts = useAccountOptions();
  const campaigns = useCampaignOptions();
  const users = useAssignableUsers();
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateLeadDto[]>([]);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: toForm(lead),
  });
  const consents = useFieldArray({ control: form.control, name: 'consents' });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setDuplicates([]);
    const tags = (form.getValues('tagsText') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      if (lead) {
        const { consents: _c, ...rest } = values;
        await api.patch(`/leads/${lead.id}`, { ...rest, tags });
        toast.success('Prospek diperbarui');
      } else {
        const created = await api.post<LeadDetailDto>('/leads', { ...values, tags });
        toast.success(
          created.doNotContact
            ? 'Prospek disimpan — kontak ini ada di daftar larangan'
            : 'Prospek ditambahkan',
        );
        router.push(`/leads/${created.id}`);
      }
      await invalidate();
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const details = e.details as { duplicates?: DuplicateLeadDto[] } | undefined;
        setDuplicates(details?.duplicates ?? []);
      }
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      {duplicates.length > 0 && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> Kemungkinan duplikat:
          </p>
          <ul className="mt-1 list-disc pl-6">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/leads/${d.id}`}
                  className="text-brand-text hover:underline"
                  onClick={onDone}
                >
                  {d.name ?? 'Prospek tanpa nama'}
                </Link>{' '}
                — cocok pada{' '}
                {d.matchedOn
                  .map((m) => ({ tiktokUsername: 'username', email: 'email', phone: 'telepon' })[m])
                  .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nama" htmlFor="l-name" error={errors.name?.message}>
          <Input id="l-name" {...form.register('name')} />
        </FormField>
        <FormField label="Username TikTok" htmlFor="l-tt" error={errors.tiktokUsername?.message}>
          <Input id="l-tt" placeholder="@username" {...form.register('tiktokUsername')} />
        </FormField>
        <FormField label="Email" htmlFor="l-email" error={errors.email?.message}>
          <Input id="l-email" type="email" {...form.register('email')} />
        </FormField>
        <FormField label="Telepon / WhatsApp" htmlFor="l-phone" error={errors.phone?.message}>
          <Input id="l-phone" inputMode="tel" placeholder="0812…" {...form.register('phone')} />
        </FormField>
        <FormField label="Sumber prospek" error={errors.source?.message}>
          <Controller
            control={form.control}
            name="source"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {LEAD_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Ketertarikan" error={errors.interestLevel?.message}>
          <Controller
            control={form.control}
            name="interestLevel"
            render={({ field }) => (
              <Select value={field.value ?? 'UNKNOWN'} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTEREST_LEVELS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {INTEREST_LEVEL_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Akun TikTok sumber">
          <OptionalSelect
            control={form.control}
            name="sourceAccountId"
            placeholder="Tidak ada"
            options={(accounts.data ?? []).map((a) => ({ value: a.id, label: `@${a.username}` }))}
          />
        </FormField>
        {!HIDE_OFFICIAL_LANE && (
          <FormField label="Campaign sumber">
            <OptionalSelect
              control={form.control}
              name="sourceCampaignId"
              placeholder="Tidak ada"
              options={(campaigns.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </FormField>
        )}
        <FormField label="Operator">
          <OptionalSelect
            control={form.control}
            name="operatorId"
            placeholder="Belum ditugaskan"
            options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          />
        </FormField>
        <FormField label="Jadwal follow-up" htmlFor="l-fu" error={errors.nextFollowUpAt?.message}>
          <Input id="l-fu" type="datetime-local" {...form.register('nextFollowUpAt')} />
        </FormField>
      </div>
      <FormField label="Tag" htmlFor="l-tags" hint="Pisahkan dengan koma, mis. webinar, vip">
        <Input id="l-tags" {...form.register('tagsText')} />
      </FormField>
      <FormField label="Catatan" htmlFor="l-notes" error={errors.notes?.message}>
        <Textarea id="l-notes" rows={2} {...form.register('notes')} />
      </FormField>

      {!lead && (
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-success" /> Izin komunikasi
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={consents.fields.length >= CONTACT_CHANNELS.length}
              onClick={() =>
                consents.append({ channel: 'WHATSAPP', source: 'LEAD_FORM', evidence: '' })
              }
            >
              <Plus /> Tambah izin
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Catat hanya bila prospek benar-benar menyetujui dihubungi melalui kanal tersebut,
            beserta buktinya.
          </p>
          {consents.fields.map((f, i) => (
            <div
              key={f.id}
              className="mt-3 grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <Controller
                control={form.control}
                name={`consents.${i}.channel`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Kanal">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTACT_CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CONTACT_CHANNEL_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Controller
                control={form.control}
                name={`consents.${i}.source`}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Sumber izin">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSENT_SOURCES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CONSENT_SOURCE_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Hapus izin"
                onClick={() => consents.remove(i)}
              >
                <X />
              </Button>
              <div className="sm:col-span-3">
                <Input
                  placeholder="Bukti, mis. 'Centang izin WA di form lead 15/10'"
                  aria-invalid={!!errors.consents?.[i]?.evidence}
                  {...form.register(`consents.${i}.evidence`)}
                />
                {errors.consents?.[i]?.evidence && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.consents[i]?.evidence?.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {lead ? 'Simpan perubahan' : 'Tambah prospek'}
        </Button>
      </DialogFooter>
    </form>
  );
}
