import { PERMISSIONS } from '@smge/shared';
import { redirect } from 'next/navigation';
import { RequirePermission } from '@/components/guards';
import { EmailPage } from '@/features/email/email-page';
import { HIDE_EMAIL_OUTREACH } from '@/lib/feature-flags';

export default function Page() {
  if (HIDE_EMAIL_OUTREACH) redirect('/');
  return (
    <RequirePermission permission={PERMISSIONS.OUTREACH_WORK}>
      <EmailPage />
    </RequirePermission>
  );
}
