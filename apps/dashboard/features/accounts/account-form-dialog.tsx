'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createTikTokAccountSchema,
  LANE_LABELS,
  TIKTOK_ACCOUNT_TYPE_LABELS,
  TIKTOK_ACCOUNT_TYPES,
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
import { Input, Label } from '@/components/ui/primitives';
import { applyServerErrors } from '@/lib/api';
import { HIDE_OFFICIAL_LANE, VISIBLE_MARKETING_LANES } from '@/lib/marketing-scope';
import { useSaveAccount } from './api';

const accountFormSchema = createTikTokAccountSchema.omit({ displayName: true, status: true });
type FormInput = z.input<typeof accountFormSchema>;
type FormOutput = z.output<typeof accountFormSchema>;

const EMPTY: FormInput = {
  username: '',
  profileUrl: '',
  avatarUrl: '',
  accountType: 'PERSONAL',
  isVerified: false,
  followersCount: 0,
  lane: 'OUTBOUND',
  notes: '',
};

function toForm(a: TikTokAccountDto): FormInput {
  return {
    username: a.username,
    profileUrl: a.profileUrl ?? '',
    avatarUrl: a.avatarUrl ?? '',
    accountType: a.accountType,
    isVerified: a.isVerified,
    followersCount: a.followersCount,
    lane: a.lane,
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
    resolver: zodResolver(accountFormSchema),
    defaultValues: account ? toForm(account) : EMPTY,
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await save.mutateAsync({
        id: account?.id,
        data: {
          ...values,
          displayName: account?.displayName || values.username,
          status: account?.status ?? 'ACTIVE',
        },
      });
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

        {!HIDE_OFFICIAL_LANE && (
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
                    {VISIBLE_MARKETING_LANES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {LANE_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        )}
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

        <FormField label="URL profil (wajib)" htmlFor="profileUrl" error={errors.profileUrl?.message}>
          <Input
            id="profileUrl"
            type="url"
            required
            aria-required="true"
            aria-invalid={!!errors.profileUrl}
            placeholder="https://www.tiktok.com/@…"
            {...form.register('profileUrl')}
          />
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
