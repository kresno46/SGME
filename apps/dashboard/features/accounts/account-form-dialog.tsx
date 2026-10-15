'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createTikTokAccountSchema,
  LANE_LABELS,
  MARKETING_LANES,
  TIKTOK_ACCOUNT_STATUS_LABELS,
  TIKTOK_ACCOUNT_STATUSES,
  TIKTOK_ACCOUNT_TYPE_LABELS,
  TIKTOK_ACCOUNT_TYPES,
  type CreateTikTokAccountInput,
} from '@smge/shared';
import type { TikTokAccountDto } from '@smge/types';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
  Switch,
} from '@/components/ui/overlays';
import { Input, Label, Textarea } from '@/components/ui/primitives';
import { applyServerErrors } from '@/lib/api';
import { useSaveAccount } from './api';

type FormInput = z.input<typeof createTikTokAccountSchema>;
type FormOutput = z.output<typeof createTikTokAccountSchema>;

const EMPTY: FormInput = {
  username: '',
  displayName: '',
  profileUrl: '',
  avatarUrl: '',
  accountType: 'PERSONAL',
  isVerified: false,
  followersCount: 0,
  lane: 'OUTBOUND',
  status: 'ACTIVE',
  notes: '',
};

function toForm(a: TikTokAccountDto): FormInput {
  return {
    username: a.username,
    displayName: a.displayName,
    profileUrl: a.profileUrl ?? '',
    avatarUrl: a.avatarUrl ?? '',
    accountType: a.accountType,
    isVerified: a.isVerified,
    followersCount: a.followersCount,
    lane: a.lane,
    status: a.status,
    notes: a.notes ?? '',
  };
}

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: TikTokAccountDto | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit akun TikTok' : 'Tambah akun TikTok'}</DialogTitle>
          <DialogDescription>
            Data diisi manual. Sinkronisasi otomatis tersedia setelah integrasi OAuth resmi TikTok
            (Fase 4). Password TikTok tidak pernah diminta.
          </DialogDescription>
        </DialogHeader>
        {/* Form di-mount ulang setiap dialog dibuka sehingga state selalu bersih */}
        <AccountForm account={account} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  account,
  onDone,
}: {
  account?: TikTokAccountDto | null;
  onDone: () => void;
}) {
  const save = useSaveAccount();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createTikTokAccountSchema),
    defaultValues: account ? toForm(account) : EMPTY,
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync({ id: account?.id, data: values as CreateTikTokAccountInput });
      toast.success(account ? 'Akun berhasil diperbarui' : 'Akun berhasil ditambahkan');
      onDone();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Username TikTok" htmlFor="username" error={errors.username?.message}>
          <Input
            id="username"
            placeholder="@solidmini"
            aria-invalid={!!errors.username}
            {...form.register('username')}
          />
        </FormField>
        <FormField label="Nama tampilan" htmlFor="displayName" error={errors.displayName?.message}>
          <Input
            id="displayName"
            aria-invalid={!!errors.displayName}
            {...form.register('displayName')}
          />
        </FormField>

        <FormField label="Jalur pemasaran" error={errors.lane?.message}>
          <Controller
            control={form.control}
            name="lane"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-invalid={!!errors.lane}>
                  <SelectValue placeholder="Pilih jalur" />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_LANES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LANE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Jenis akun" error={errors.accountType?.message}>
          <Controller
            control={form.control}
            name="accountType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIKTOK_ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIKTOK_ACCOUNT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField
          label="Jumlah followers"
          htmlFor="followersCount"
          error={errors.followersCount?.message}
          hint="Ditandai sebagai input manual"
        >
          <Input
            id="followersCount"
            type="number"
            min={0}
            inputMode="numeric"
            aria-invalid={!!errors.followersCount}
            {...form.register('followersCount')}
          />
        </FormField>
        <FormField label="Status akun" error={errors.status?.message}>
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIKTOK_ACCOUNT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {TIKTOK_ACCOUNT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField label="URL profil" htmlFor="profileUrl" error={errors.profileUrl?.message}>
          <Input
            id="profileUrl"
            placeholder="https://www.tiktok.com/@…"
            {...form.register('profileUrl')}
          />
        </FormField>
        <FormField label="URL foto profil" htmlFor="avatarUrl" error={errors.avatarUrl?.message}>
          <Input id="avatarUrl" placeholder="https://…" {...form.register('avatarUrl')} />
        </FormField>
      </div>

      <div className="flex items-center gap-3 rounded-md border p-3">
        <Controller
          control={form.control}
          name="isVerified"
          render={({ field }) => (
            <Switch id="isVerified" checked={!!field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Label htmlFor="isVerified" className="font-normal">
          Akun terverifikasi (centang biru)
        </Label>
      </div>

      <FormField label="Catatan" htmlFor="notes" error={errors.notes?.message}>
        <Textarea id="notes" rows={3} {...form.register('notes')} />
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {account ? 'Simpan perubahan' : 'Tambah akun'}
        </Button>
      </DialogFooter>
    </form>
  );
}
