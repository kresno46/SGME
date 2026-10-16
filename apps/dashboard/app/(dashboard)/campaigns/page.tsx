'use client';

import { PERMISSIONS } from '@smge/shared';
import { RequirePermission } from '@/components/guards';
import { CampaignsPage } from '@/features/campaigns/campaigns-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.CAMPAIGNS_READ}>
      <CampaignsPage />
    </RequirePermission>
  );
}
