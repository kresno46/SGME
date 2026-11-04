'use client';

import { PERMISSIONS } from '@smge/shared';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/guards';
import { WhatsappPage } from '@/features/whatsapp/whatsapp-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.WHATSAPP_USE}>
      <Suspense>
        <WhatsappPage />
      </Suspense>
    </RequirePermission>
  );
}
