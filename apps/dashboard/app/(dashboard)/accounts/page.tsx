'use client';

import { PERMISSIONS } from '@smge/shared';
import { RequirePermission } from '@/components/guards';
import { AccountsPage } from '@/features/accounts/accounts-page';

export default function Page() {
  return (
    <RequirePermission permission={PERMISSIONS.ACCOUNTS_READ}>
      <AccountsPage />
    </RequirePermission>
  );
}
