'use client';

import '@smge/shared'; // memasang pesan error Zod berbahasa Indonesia
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
        mutationCache: new MutationCache({
          // Error mutasi tanpa penanganan khusus ditampilkan sebagai toast.
          onError: (err, _v, _c, mutation) => {
            if (mutation.options.onError) return;
            toast.error(err instanceof Error ? err.message : 'Terjadi kesalahan');
          },
        }),
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
