'use client';

import { PERMISSIONS } from '@smge/shared';
import { use } from 'react';
import { RequirePermission } from '@/components/guards';
import { CampaignDetail } from '@/features/campaigns/campaign-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequirePermission permission={PERMISSIONS.CAMPAIGNS_READ}>
      <CampaignDetail id={id} />
    </RequirePermission>
  );
}
