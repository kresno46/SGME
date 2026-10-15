import {
  INTEGRATION_STATUS_LABELS,
  LANE_SHORT_LABELS,
  TIKTOK_ACCOUNT_STATUS_LABELS,
  type IntegrationStatus,
  type MarketingLane,
  type TikTokAccountStatus,
} from '@smge/shared';
import { CircleCheck, CircleDashed, CircleX, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';

export function LaneBadge({ lane }: { lane: MarketingLane }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span
        className="size-2 rounded-full"
        style={{
          background: lane === 'OFFICIAL' ? 'var(--lane-official)' : 'var(--lane-outbound)',
        }}
      />
      {lane === 'OFFICIAL' ? 'A' : 'B'} · {LANE_SHORT_LABELS[lane]}
    </Badge>
  );
}

const STATUS_VARIANT: Record<
  TikTokAccountStatus,
  'success' | 'secondary' | 'warning' | 'destructive'
> = {
  ACTIVE: 'success',
  PAUSED: 'secondary',
  RESTRICTED: 'destructive',
  ARCHIVED: 'secondary',
};

export function AccountStatusBadge({ status }: { status: TikTokAccountStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{TIKTOK_ACCOUNT_STATUS_LABELS[status]}</Badge>;
}

/** Status integrasi selalu dengan ikon + teks (tidak hanya warna). */
export function IntegrationBadge({ status }: { status: IntegrationStatus }) {
  const map = {
    CONNECTED: { variant: 'success', Icon: CircleCheck },
    TOKEN_EXPIRED: { variant: 'warning', Icon: Clock },
    ERROR: { variant: 'destructive', Icon: CircleX },
    REVOKED: { variant: 'destructive', Icon: CircleX },
    NOT_CONNECTED: { variant: 'secondary', Icon: CircleDashed },
  } as const;
  const { variant, Icon } = map[status];
  return (
    <Badge variant={variant}>
      <Icon /> {INTEGRATION_STATUS_LABELS[status]}
    </Badge>
  );
}
