'use client';

import { PERMISSIONS } from '@smge/shared';
import { RequirePermission } from '@/components/guards';
import { DashboardOverviewPage } from '@/features/dashboard/overview';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
      <DashboardOverviewPage />
    </RequirePermission>
  );
}
