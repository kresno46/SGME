'use client';

import { PERMISSIONS } from '@smge/shared';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/guards';
import { AiSalesPage } from '@/features/ai/ai-sales-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.AI_USE} superAdminOnly>
      <Suspense>
        <AiSalesPage />
      </Suspense>
    </RequirePermission>
  );
}
