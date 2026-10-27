'use client';

import { Loader2, ServerCrash } from 'lucide-react';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { AuthProvider, useMe } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const sessionEnded = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    // On a fresh page load AuthProvider has not mounted its expiry handler yet.
    if (sessionEnded) window.location.replace('/login?reason=session-ended');
  }, [sessionEnded]);

  if (sessionEnded) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        Sesi berakhir. Mengarahkan ke halaman login…
      </div>
    );
  }

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Memuat…
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <EmptyState
          icon={ServerCrash}
          title="Tidak dapat memuat sesi"
          description={
            me.error?.message ?? 'Server tidak merespons. Periksa koneksi lalu coba lagi.'
          }
          action={<Button onClick={() => void me.refetch()}>Coba lagi</Button>}
        />
      </div>
    );
  }

  return (
    <AuthProvider user={me.data}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
