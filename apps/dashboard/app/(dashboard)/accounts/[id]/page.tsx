'use client';

import { PERMISSIONS } from '@smge/shared';
import { use } from 'react';
import { RequirePermission } from '@/components/guards';
import { AccountDetail } from '@/features/accounts/account-detail';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequirePermission permission={PERMISSIONS.ACCOUNTS_READ}>
      <AccountDetail id={id} />
    </RequirePermission>
  );
}
