'use client';

import { PERMISSIONS } from '@smge/shared';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/guards';
import { IntegrationsPage } from '@/features/integrations/integrations-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.INTEGRATIONS_READ}>
      <Suspense>
        <IntegrationsPage />
      </Suspense>
    </RequirePermission>
  );
}
