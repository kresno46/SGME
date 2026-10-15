'use client';

import { PERMISSIONS } from '@smge/shared';
import { History, ShieldCheck, UserCog, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { AuditCard } from '@/features/settings/audit';
import { ChangePasswordCard, SessionsCard, TwoFactorCard } from '@/features/settings/security';
import { RolesCard, UsersCard } from '@/features/settings/users';
import { useAuth } from '@/hooks/use-auth';

function SettingsTabs() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const tabs = [
    { value: 'keamanan', label: 'Profil & keamanan', icon: ShieldCheck, show: true },
    { value: 'pengguna', label: 'Pengguna', icon: Users, show: can(PERMISSIONS.USERS_READ) },
    { value: 'role', label: 'Role & akses', icon: UserCog, show: can(PERMISSIONS.ROLES_READ) },
    { value: 'audit', label: 'Log audit', icon: History, show: can(PERMISSIONS.AUDIT_READ) },
  ].filter((t) => t.show);
  const requested = params.get('tab');
  const current = tabs.some((t) => t.value === requested) ? requested! : 'keamanan';

  return (
    <Tabs
      value={current}
      onValueChange={(v) => router.replace(`/settings?tab=${v}`, { scroll: false })}
    >
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            <t.icon /> {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="keamanan" className="grid gap-4 lg:grid-cols-2">
        <ChangePasswordCard />
        <div className="grid content-start gap-4">
          <TwoFactorCard />
        </div>
        <div className="lg:col-span-2">
          <SessionsCard />
        </div>
      </TabsContent>
      {can(PERMISSIONS.USERS_READ) && (
        <TabsContent value="pengguna">
          <UsersCard />
        </TabsContent>
      )}
      {can(PERMISSIONS.ROLES_READ) && (
        <TabsContent value="role">
          <RolesCard />
        </TabsContent>
      )}
      {can(PERMISSIONS.AUDIT_READ) && (
        <TabsContent value="audit">
          <AuditCard />
        </TabsContent>
      )}
    </Tabs>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Keamanan akun, pengguna, hak akses, dan log aktivitas."
      />
      <Suspense>
        <SettingsTabs />
      </Suspense>
    </>
  );
}
