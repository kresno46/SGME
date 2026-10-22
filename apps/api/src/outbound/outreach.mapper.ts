import type { OutreachTaskStatus, Prisma } from '@smge/database';
import { PERMISSIONS, type Permission, type TaskAction } from '@smge/shared';
import type { OutreachTaskDto } from '@smge/types';
import type { RequestUser } from '../common/decorators/auth.decorators';
import {
  ACCOUNT_REF_SELECT,
  CAMPAIGN_REF_SELECT,
  USER_REF_SELECT,
  iso,
  toAccountRef,
  toRef,
} from '../common/utils/refs';

export type ActionName = TaskAction['action'] | 'edit_draft';

/** Aksi → status asal yang diizinkan, status tujuan, dan permission yang diperlukan. */
export const ACTION_RULES: Record<
  ActionName,
  { from: OutreachTaskStatus[]; to: OutreachTaskStatus | null; permission: Permission }
> = {
  edit_draft: { from: ['DRAFT', 'FOLLOW_UP'], to: null, permission: PERMISSIONS.OUTREACH_WORK },
  submit: {
    from: ['DRAFT', 'FOLLOW_UP'],
    to: 'WAITING_REVIEW',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
  approve: {
    from: ['WAITING_REVIEW', 'FOLLOW_UP'],
    to: 'APPROVED',
    permission: PERMISSIONS.OUTREACH_REVIEW,
  },
  reject: { from: ['WAITING_REVIEW'], to: 'DRAFT', permission: PERMISSIONS.OUTREACH_REVIEW },
  reopen: { from: ['APPROVED'], to: 'DRAFT', permission: PERMISSIONS.OUTREACH_WORK },
  mark_sent: {
    from: ['APPROVED', 'FOLLOW_UP'],
    to: 'MANUALLY_SENT',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
  log_reply: {
    from: ['MANUALLY_SENT', 'BROWSER_SENT', 'FOLLOW_UP'],
    to: 'REPLIED',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
  schedule_follow_up: {
    from: ['MANUALLY_SENT', 'BROWSER_SENT', 'REPLIED'],
    to: 'FOLLOW_UP',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
  complete: {
    from: ['MANUALLY_SENT', 'BROWSER_SENT', 'REPLIED', 'FOLLOW_UP'],
    to: 'COMPLETED',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
  cancel: {
    from: ['DRAFT', 'WAITING_REVIEW', 'APPROVED', 'FOLLOW_UP'],
    to: 'CANCELLED',
    permission: PERMISSIONS.OUTREACH_WORK,
  },
};

export const OUTREACH_INCLUDE = {
  lead: {
    select: {
      id: true,
      name: true,
      tiktokUsername: true,
      email: true,
      phone: true,
      status: true,
      interestLevel: true,
      consents: { where: { status: 'GRANTED' }, select: { channel: true } },
    },
  },
  tiktokAccount: { select: ACCOUNT_REF_SELECT },
  campaign: { select: CAMPAIGN_REF_SELECT },
  template: { select: { id: true, name: true } },
  operator: { select: USER_REF_SELECT },
  reviewer: { select: USER_REF_SELECT },
} satisfies Prisma.OutreachTaskInclude;

export type OutreachTaskRow = Prisma.OutreachTaskGetPayload<{ include: typeof OUTREACH_INCLUDE }>;

export const OutreachMapper = {
  include: OUTREACH_INCLUDE,

  allowedActions(status: OutreachTaskStatus, user: RequestUser | null): ActionName[] {
    if (!user) return [];
    return (Object.entries(ACTION_RULES) as [ActionName, (typeof ACTION_RULES)[ActionName]][])
      .filter(([, r]) => r.from.includes(status) && user.permissions.includes(r.permission))
      .map(([name]) => name);
  },

  toDto(t: OutreachTaskRow, user: RequestUser | null): OutreachTaskDto {
    return {
      id: t.id,
      status: t.status,
      channel: t.channel,
      lead: {
        id: t.lead.id,
        name: t.lead.name,
        tiktokUsername: t.lead.tiktokUsername,
        email: t.lead.email,
        phone: t.lead.phone,
        status: t.lead.status,
        interestLevel: t.lead.interestLevel,
        consentChannels: t.lead.consents.map((c) => c.channel),
      },
      account: toAccountRef(t.tiktokAccount),
      campaign: toRef(t.campaign),
      template: toRef(t.template),
      operator: toRef(t.operator),
      reviewer: toRef(t.reviewer),
      draftMessage: t.draftMessage,
      finalMessage: t.finalMessage,
      aiGenerated: t.aiGenerated,
      priority: t.priority,
      reviewNote: t.reviewNote,
      submittedAt: iso(t.submittedAt),
      approvedAt: iso(t.approvedAt),
      sentConfirmedAt: iso(t.sentConfirmedAt),
      lastSentAt: iso(t.lastSentAt),
      sentCount: t.sentCount,
      repliedAt: iso(t.repliedAt),
      responseSummary: t.responseSummary,
      followUpAt: iso(t.followUpAt),
      completedAt: iso(t.completedAt),
      outcome: t.outcome,
      cancelReason: t.cancelReason,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      allowedActions: OutreachMapper.allowedActions(t.status, user),
    };
  },
};
