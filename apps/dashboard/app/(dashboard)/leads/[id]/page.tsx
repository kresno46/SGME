'use client';

import { PERMISSIONS } from '@smge/shared';
import { use } from 'react';
import { RequirePermission } from '@/components/guards';
import { LeadDetail } from '@/features/leads/lead-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequirePermission permission={PERMISSIONS.LEADS_READ} superAdminOnly>
      <LeadDetail id={id} />
    </RequirePermission>
  );
}
