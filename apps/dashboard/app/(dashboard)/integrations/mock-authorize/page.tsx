'use client';

import { PERMISSIONS } from '@smge/shared';
import type { AccountRefDto } from '@smge/types';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { EmptyState, FormField } from '@/components/common';
import { RequirePermission } from '@/components/guards';
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
import { api } from '@/lib/api';

/**
 * Halaman persetujuan SIMULASI untuk Mock Adapter — meniru langkah "izinkan akses" di TikTok.
 * Hanya tersedia bila TIKTOK_USE_MOCK aktif (development).
 */
function MockAuthorize() {
  const state = useSearchParams().get('state') ?? '';
  const q = useQuery({
    queryKey: ['integrations', 'mock-state', state],
    queryFn: () =>
      api.get<{ account: AccountRefDto; scopes: string[] }>('/integrations/tiktok/mock/state', {
        state,
      }),
    retry: false,
  });
  const [username, setUsername] = useState<string | null>(null);
  const callback = (params: Record<string, string>) =>
    `/api/integrations/tiktok/callback?${new URLSearchParams({ state, ...params }).toString()}`;

  if (q.isPending) return null;
  if (q.isError)
    return <EmptyState title="Sesi otorisasi tidak valid" description={q.error.message} />;
  const value = username ?? q.data.account.username;

  return (
    <div className="mx-auto max-w-md py-8">
      <Card className="border-dashed border-warning">
        <CardHeader>
          <Badge variant="simulation" className="w-fit">
            <FlaskConical /> SIMULASI — bukan halaman TikTok
          </Badge>
          <CardTitle className="mt-2 flex items-center gap-2">
            <ShieldCheck className="size-5" /> Izinkan Solid Mini Growth Engine?
          </CardTitle>
          <CardDescription>
            Pada koneksi resmi, langkah ini terjadi di TikTok dan pemilik akun login dengan akunnya
            sendiri. Di sini Anda dapat mensimulasikan akun mana yang menyetujui.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormField
            label="Akun TikTok yang menyetujui (simulasi)"
            htmlFor="mock-user"
            hint={`Akun yang dipilih di SMGE: @${q.data.account.username}. Isi username lain untuk menguji penolakan akun berbeda.`}
          >
            <Input
              id="mock-user"
              value={value}
              onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
            />
          </FormField>
          <div>
            <p className="text-xs text-muted-foreground">Akses yang diminta</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {q.data.scopes.map((s) => (
                <Badge key={s} variant="outline" className="font-mono">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild className="flex-1">
              <a href={callback({ code: `mock:${value}`, scopes: q.data.scopes.join(',') })}>
                Izinkan
              </a>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <a href={callback({ error: 'access_denied', error_description: 'User canceled' })}>
                Tolak
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.INTEGRATIONS_MANAGE}>
      <Suspense>
        <MockAuthorize />
      </Suspense>
    </RequirePermission>
  );
}
