'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@smge/shared';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormError, FormField } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', values);
      setSentMessage(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan');
    }
  });

  if (sentMessage) {
    return (
      <div className="grid gap-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <p className="text-sm">{sentMessage}</p>
        <Button asChild variant="outline">
          <Link href="/login">Kembali ke halaman masuk</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Lupa password</h1>
        <p className="text-sm text-muted-foreground">
          Kami akan mengirim link untuk membuat password baru.
        </p>
      </div>
      <FormError message={error} />
      <FormField label="Email" htmlFor="email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoFocus
          aria-invalid={!!errors.email}
          {...form.register('email')}
        />
      </FormField>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="animate-spin" />}
        Kirim link reset
      </Button>
      <Button asChild variant="ghost">
        <Link href="/login">Kembali</Link>
      </Button>
    </form>
  );
}
