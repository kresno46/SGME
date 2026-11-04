'use client';

import { BellOff, MessageCircle, Send, Smartphone, Users } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, PageHeader } from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { AdminSessions } from './admin-sessions';
import { useSessions, useWhatsappConfig } from './api';
import { BroadcastPanel } from './broadcast-panel';
import { Inbox } from './inbox';
import { NumbersPanel } from './numbers-panel';

const TABS = ['chat', 'numbers', 'broadcast', 'admin'] as const;

export function WhatsappPage() {
  const { user } = useAuth();
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const config = useWhatsappConfig();
  const sessions = useSessions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('tab');
  const broadcastEnabled = config.data?.broadcast.enabled ?? false;
  const tab =
    TABS.find(
      (t) =>
        t === requested &&
        (t !== 'admin' || isSuperAdmin) &&
        (t !== 'broadcast' || broadcastEnabled),
    ) ?? 'chat';
  const setTab = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const lostLabels = (sessions.data ?? []).filter((s) => s.connectionLost).map((s) => s.label);

  if (config.isLoading) return <Skeleton className="h-64 w-full" />;
  if (!config.data?.enabled)
    return (
      <>
        <PageHeader
          title="WhatsApp"
          description="Chat dua arah lewat nomor WhatsApp Anda sendiri."
        />
        <EmptyState
          icon={BellOff}
          title="WhatsApp belum diaktifkan"
          description="Fitur ini aktif setelah server WAHA dikonfigurasi (WAHA_ENABLED, WAHA_BASE_URL, WAHA_API_KEY). Hubungi administrator."
        />
      </>
    );

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Chat dua arah lewat nomor WhatsApp Anda sendiri. Setiap pesan dibalas oleh manusia."
      />
      {lostLabels.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>
            {lostLabels.length === 1
              ? `Nomor "${lostLabels[0]}" terputus.`
              : `${lostLabels.length} nomor terputus: ${lostLabels.map((l) => `"${l}"`).join(', ')}.`}{' '}
            Pesan baru tidak akan masuk sampai tersambung lagi.
          </span>
          <button className="font-medium underline" onClick={() => setTab('numbers')}>
            Buka pengaturan nomor
          </button>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="chat">
            <MessageCircle /> Chat
          </TabsTrigger>
          <TabsTrigger value="numbers">
            <Smartphone /> Nomor saya
          </TabsTrigger>
          {broadcastEnabled && (
            <TabsTrigger value="broadcast">
              <Send /> Kirim terjadwal
            </TabsTrigger>
          )}
          {isSuperAdmin && (
            <TabsTrigger value="admin">
              <Users /> Semua nomor
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <Inbox sessionLinked={sessions.data?.some((s) => s.status === 'WORKING') ?? false} />
        </TabsContent>
        <TabsContent value="numbers" className="mt-4">
          <NumbersPanel />
        </TabsContent>
        {broadcastEnabled && (
          <TabsContent value="broadcast" className="mt-4">
            <BroadcastPanel />
          </TabsContent>
        )}
        {isSuperAdmin && (
          <TabsContent value="admin" className="mt-4">
            <AdminSessions />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
