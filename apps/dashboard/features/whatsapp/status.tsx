import { WAHA_SESSION_STATUS_LABELS, type WahaSessionStatus } from '@smge/shared';
import { Badge } from '@/components/ui/primitives';

type Variant = 'success' | 'warning' | 'destructive' | 'secondary';

const VARIANTS: Record<string, Variant> = {
  WORKING: 'success',
  SCAN_QR_CODE: 'warning',
  STARTING: 'warning',
  STOPPED: 'secondary',
  NOT_CREATED: 'secondary',
  NOT_CONFIGURED: 'secondary',
};

export function SessionStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANTS[status] ?? 'destructive'}>
      {WAHA_SESSION_STATUS_LABELS[status as WahaSessionStatus] ?? status}
    </Badge>
  );
}
