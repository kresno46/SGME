'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput } from '@smge/shared';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormError, FormField } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { api, applyServerErrors } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <div className="grid gap-4">
        <FormError message="Link reset password tidak valid. Minta link baru dari halaman lupa password." />
        <Button asChild variant="outline">
          <Link href="/forgot-password">Minta link baru</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/reset-password', values);
      toast.success(res.message);
      router.replace('/login');
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Buat password baru</h1>
        <p className="text-sm text-muted-foreground">
          Minimal 10 karakter dengan huruf besar, huruf kecil, dan angka.
        </p>
      </div>
      <FormError message={error} />
      <FormField label="Password baru" htmlFor="password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...form.register('password')}
        />
      </FormField>
      <FormField
        label="Ulangi password"
        htmlFor="confirmPassword"
        error={errors.confirmPassword?.message}
      >
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...form.register('confirmPassword')}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Simpan password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
