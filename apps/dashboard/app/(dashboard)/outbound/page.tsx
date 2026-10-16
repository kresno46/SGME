'use client';

import { PERMISSIONS } from '@smge/shared';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/guards';
import { OutboundPage } from '@/features/outbound/outbound-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.OUTREACH_WORK}>
      <Suspense>
        <OutboundPage />
      </Suspense>
    </RequirePermission>
  );
}
