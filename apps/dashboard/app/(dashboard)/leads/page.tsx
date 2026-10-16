'use client';

import { PERMISSIONS } from '@smge/shared';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/guards';
import { LeadsPage } from '@/features/leads/leads-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.LEADS_READ}>
      <Suspense>
        <LeadsPage />
      </Suspense>
    </RequirePermission>
  );
}
