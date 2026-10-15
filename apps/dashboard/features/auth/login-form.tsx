'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, totpCodeSchema, type LoginInput } from '@smge/shared';
import type { LoginResponse } from '@smge/types';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormError, FormField } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { ME_QUERY_KEY } from '@/hooks/use-auth';
import { api, ApiError } from '@/lib/api';

/** Hanya izinkan redirect ke path internal (mencegah open redirect). */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [challenge, setChallenge] = useState<string | null>(null);

  const finish = (res: LoginResponse) => {
    if (res.status === 'TWO_FACTOR_REQUIRED') {
      setChallenge(res.challengeToken);
      return;
    }
    qc.setQueryData(ME_QUERY_KEY, res.user);
    router.replace(safeNext(params.get('next')));
    router.refresh();
  };

  return challenge ? (
    <TwoFactorStep challengeToken={challenge} onDone={finish} onBack={() => setChallenge(null)} />
  ) : (
    <PasswordStep onDone={finish} />
  );
}

function PasswordStep({ onDone }: { onDone: (r: LoginResponse) => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      onDone(await api.post<LoginResponse>('/auth/login', values));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server');
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Masuk</h1>
        <p className="text-sm text-muted-foreground">Gunakan akun yang diberikan administrator.</p>
      </div>
      <FormError message={error} />
      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          aria-invalid={!!errors.email}
          {...form.register('email')}
        />
      </FormField>
      <FormField label="Password" htmlFor="password" error={errors.password?.message}>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </FormField>
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Lupa password?
        </Link>
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Masuk
      </Button>
    </form>
  );
}

const codeSchema = z.object({ code: totpCodeSchema });

function TwoFactorStep({
  challengeToken,
  onDone,
  onBack,
}: {
  challengeToken: string;
  onDone: (r: LoginResponse) => void;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ code: string }>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setError(null);
    try {
      onDone(await api.post<LoginResponse>('/auth/2fa/verify', { challengeToken, code }));
    } catch (e) {
      form.reset({ code: '' });
      setError(e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server');
      if (e instanceof ApiError && e.status === 401 && /berakhir/.test(e.message)) onBack();
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Verifikasi dua langkah</h1>
          <p className="text-sm text-muted-foreground">
            Masukkan 6 digit kode dari aplikasi authenticator Anda.
          </p>
        </div>
      </div>
      <FormError message={error} />
      <FormField label="Kode verifikasi" htmlFor="code" error={errors.code?.message}>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          className="text-center text-lg tracking-[0.5em]"
          aria-invalid={!!errors.code}
          {...form.register('code')}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Verifikasi
      </Button>
      <Button type="button" variant="ghost" onClick={onBack}>
        Kembali
      </Button>
    </form>
  );
}
