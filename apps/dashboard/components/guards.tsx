'use client';

import type { Permission } from '@smge/shared';
import {
  BarChart3,
  Bot,
  Cable,
  Construction,
  Megaphone,
  MessagesSquare,
  Send,
  ShieldX,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/common';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';

/** Menampilkan halaman "tidak ada akses" bila permission tidak dimiliki. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Akses ditolak"
        description="Role Anda tidak memiliki izin untuk membuka halaman ini. Hubungi administrator bila Anda memerlukannya."
      />
    );
  }
  return <>{children}</>;
}

/** Ikon dipilih lewat nama karena komponen tidak bisa dikirim dari Server Component. */
const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Bot,
  Cable,
  Megaphone,
  MessagesSquare,
  Send,
  Users,
};

/** Halaman modul yang dijadwalkan pada fase berikutnya. */
export function ComingSoon({
  title,
  description,
  phase,
  icon,
  features,
  notes,
}: {
  title: string;
  description: string;
  phase: number;
  icon?: string;
  features: string[];
  notes?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Rencana modul</CardTitle>
          <Badge variant="secondary">Dijadwalkan Fase {phase}</Badge>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={(icon && ICONS[icon]) || Construction}
            title="Modul ini belum tersedia"
            description="Struktur database untuk modul ini sudah disiapkan. Antarmuka dan API akan dibangun pada fase yang dijadwalkan."
            className="py-8"
          />
          <ul className="mx-auto grid max-w-2xl gap-2 text-sm sm:grid-cols-2">
            {features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {f}
              </li>
            ))}
          </ul>
          {notes && <p className="mx-auto mt-4 max-w-2xl text-xs text-muted-foreground">{notes}</p>}
        </CardContent>
      </Card>
    </>
  );
}
