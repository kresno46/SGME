'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  type ChangePasswordInput,
} from '@smge/shared';
import type { SessionDto } from '@smge/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ConfirmDialog, FormError, FormField, TableSkeleton } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui/primitives';
import { ME_QUERY_KEY, useAuth } from '@/hooks/use-auth';
import { api, applyServerErrors } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/utils';

export function ChangePasswordCard() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/change-password', values);
      toast.success(res.message);
      form.reset();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ganti password</CardTitle>
        <CardDescription>
          Sesi di perangkat lain akan diakhiri setelah password diganti.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormError message={error} />
          <FormField
            label="Password saat ini"
            htmlFor="currentPassword"
            error={errors.currentPassword?.message}
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </FormField>
          <FormField
            label="Password baru"
            htmlFor="newPassword"
            error={errors.newPassword?.message}
            hint="Minimal 10 karakter, kombinasi huruf besar, huruf kecil, dan angka."
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </FormField>
          <FormField
            label="Ulangi password baru"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </FormField>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              Simpan password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface TwoFactorSetup {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  secret: string;
}

export function TwoFactorCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const refreshMe = () => qc.invalidateQueries({ queryKey: ME_QUERY_KEY });

  const start = useMutation({
    mutationFn: () => api.post<TwoFactorSetup>('/auth/2fa/setup'),
    onSuccess: setSetup,
  });

  const enableForm = useForm<{ code: string }>({
    resolver: zodResolver(enableTwoFactorSchema),
    defaultValues: { code: '' },
  });
  const disableForm = useForm<{ password: string; code: string }>({
    resolver: zodResolver(disableTwoFactorSchema),
    defaultValues: { password: '', code: '' },
  });

  const onEnable = enableForm.handleSubmit(async (values) => {
    try {
      await api.post('/auth/2fa/enable', values);
      toast.success('Autentikasi dua faktor aktif');
      setSetup(null);
      enableForm.reset();
      await refreshMe();
    } catch (e) {
      applyServerErrors(e, enableForm.setError);
      enableForm.setError('code', { message: e instanceof Error ? e.message : 'Kode salah' });
    }
  });

  const onDisable = disableForm.handleSubmit(async (values) => {
    try {
      await api.post('/auth/2fa/disable', values);
      toast.success('Autentikasi dua faktor dinonaktifkan');
      disableForm.reset();
      await refreshMe();
    } catch (e) {
      disableForm.setError('code', { message: e instanceof Error ? e.message : 'Gagal' });
    }
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Autentikasi dua faktor (2FA)</CardTitle>
          <CardDescription>
            Lapisan keamanan tambahan menggunakan aplikasi authenticator (TOTP).
          </CardDescription>
        </div>
        {user.twoFactorEnabled ? (
          <Badge variant="success">
            <ShieldCheck /> Aktif
          </Badge>
        ) : (
          <Badge variant="secondary">
            <ShieldOff /> Nonaktif
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {user.twoFactorEnabled ? (
          <form onSubmit={onDisable} className="grid gap-4 sm:max-w-sm" noValidate>
            <p className="text-sm text-muted-foreground">
              Untuk menonaktifkan 2FA, masukkan password dan kode saat ini.
            </p>
            <FormField
              label="Password"
              htmlFor="tfa-password"
              error={disableForm.formState.errors.password?.message}
            >
              <Input id="tfa-password" type="password" {...disableForm.register('password')} />
            </FormField>
            <FormField
              label="Kode 6 digit"
              htmlFor="tfa-code-off"
              error={disableForm.formState.errors.code?.message}
            >
              <Input
                id="tfa-code-off"
                inputMode="numeric"
                maxLength={6}
                {...disableForm.register('code')}
              />
            </FormField>
            <div>
              <Button
                type="submit"
                variant="destructive"
                disabled={disableForm.formState.isSubmitting}
              >
                Nonaktifkan 2FA
              </Button>
            </div>
          </form>
        ) : setup ? (
          <div className="grid gap-6 md:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR code */}
            <img
              src={setup.qrCodeDataUrl}
              alt="QR code 2FA"
              className="size-44 rounded-md border bg-white p-2"
            />
            <form onSubmit={onEnable} className="grid content-start gap-4" noValidate>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Pindai QR code dengan Google Authenticator, Authy, atau sejenisnya.</li>
                <li>
                  Atau masukkan kunci manual:{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all text-foreground">
                    {setup.secret}
                  </code>
                </li>
                <li>Masukkan kode 6 digit yang muncul untuk mengaktifkan.</li>
              </ol>
              <FormField
                label="Kode verifikasi"
                htmlFor="tfa-code"
                error={enableForm.formState.errors.code?.message}
              >
                <Input
                  id="tfa-code"
                  inputMode="numeric"
                  maxLength={6}
                  className="sm:max-w-40"
                  {...enableForm.register('code')}
                />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" disabled={enableForm.formState.isSubmitting}>
                  Aktifkan 2FA
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                  Batal
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending && <Loader2 className="animate-spin" />}
            Siapkan 2FA
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function SessionsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<SessionDto[]>('/auth/sessions'),
  });
  const [revoking, setRevoking] = useState<SessionDto | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sesi aktif</CardTitle>
        <CardDescription>Perangkat yang saat ini masuk ke akun Anda.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <TableSkeleton rows={2} cols={3} />
        ) : (
          <ul className="divide-y rounded-md border">
            {q.data?.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <Laptop className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium" title={s.userAgent ?? ''}>
                    {describeAgent(s.userAgent)}{' '}
                    {s.current && <Badge className="ml-1">Sesi ini</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    IP {s.ipAddress ?? '—'} · aktif {formatRelative(s.lastUsedAt)} · masuk{' '}
                    {formatDateTime(s.createdAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="outline" onClick={() => setRevoking(s)}>
                    Akhiri sesi
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Akhiri sesi ini?"
        description="Perangkat tersebut harus login ulang."
        confirmLabel="Akhiri sesi"
        destructive
        onConfirm={async () => {
          await api.delete(`/auth/sessions/${revoking!.id}`);
          toast.success('Sesi diakhiri');
          await qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
        }}
      />
    </Card>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return 'Perangkat tidak dikenal';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} di ${os}` : browser;
}
