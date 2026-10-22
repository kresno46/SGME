import {
  CAMPAIGN_STATUS_LABELS,
  INTEREST_LEVEL_LABELS,
  LEAD_STATUS_LABELS,
  OUTREACH_TASK_STATUS_LABELS,
  type CampaignStatus,
  type InterestLevel,
  type LeadStatus,
  type OutreachTaskStatus,
} from '@smge/shared';
import { Ban, Flame } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/primitives';

type Variant = NonNullable<BadgeProps['variant']>;

const LEAD_VARIANT: Record<LeadStatus, Variant> = {
  NEW: 'secondary',
  CONTACTED: 'outline',
  RESPONDED: 'default',
  INTERESTED: 'warning',
  QUALIFIED: 'warning',
  REGISTERED: 'success',
  ACTIVE: 'success',
  NOT_INTERESTED: 'secondary',
  DO_NOT_CONTACT: 'destructive',
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant={LEAD_VARIANT[status]}>
      {status === 'DO_NOT_CONTACT' && <Ban />}
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

export function InterestBadge({ level }: { level: InterestLevel }) {
  if (level === 'UNKNOWN') return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant={level === 'HIGH' ? 'warning' : 'outline'}>
      {level === 'HIGH' && <Flame />}
      {INTEREST_LEVEL_LABELS[level]}
    </Badge>
  );
}

const CAMPAIGN_VARIANT: Record<CampaignStatus, Variant> = {
  DRAFT: 'secondary',
  SCHEDULED: 'outline',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'default',
  ARCHIVED: 'secondary',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={CAMPAIGN_VARIANT[status]}>{CAMPAIGN_STATUS_LABELS[status]}</Badge>;
}

const TASK_VARIANT: Record<OutreachTaskStatus, Variant> = {
  DRAFT: 'secondary',
  WAITING_REVIEW: 'warning',
  APPROVED: 'default',
  MANUALLY_SENT: 'outline',
  BROWSER_SENT: 'outline',
  REPLIED: 'success',
  FOLLOW_UP: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
};

export function TaskStatusBadge({ status }: { status: OutreachTaskStatus }) {
  return <Badge variant={TASK_VARIANT[status]}>{OUTREACH_TASK_STATUS_LABELS[status]}</Badge>;
}
