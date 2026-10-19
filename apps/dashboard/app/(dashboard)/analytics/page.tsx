'use client';

import { PERMISSIONS } from '@smge/shared';
import { RequirePermission } from '@/components/guards';
import { AnalyticsPage } from '@/features/analytics/analytics-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.ANALYTICS_READ}>
      <AnalyticsPage />
    </RequirePermission>
  );
}
