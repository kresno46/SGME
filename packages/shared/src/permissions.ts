import type { RoleCode } from './enums';

/**
 * Daftar permission RBAC. Format: "<resource>:<action>".
 * Role menyimpan daftar permission di tabel `roles` (di-seed dari DEFAULT_ROLE_PERMISSIONS).
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:view',

  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_READ: 'roles:read',

  AUDIT_READ: 'audit:read',

  ACCOUNTS_READ: 'accounts:read',
  ACCOUNTS_MANAGE: 'accounts:manage',

  CAMPAIGNS_READ: 'campaigns:read',
  CAMPAIGNS_MANAGE: 'campaigns:manage',

  LEADS_READ: 'leads:read',
  LEADS_MANAGE: 'leads:manage',
  LEADS_EXPORT: 'leads:export',
  LEADS_IMPORT: 'leads:import',
  /** Menghapus (menganonimkan) data pribadi prospek */
  LEADS_DELETE: 'leads:delete',
  /** Menghapus entri dari daftar larangan kontak (menambah cukup leads:manage) */
  DNC_MANAGE: 'dnc:manage',

  TEMPLATES_MANAGE: 'templates:manage',

  OUTREACH_WORK: 'outreach:work',
  OUTREACH_REVIEW: 'outreach:review',

  CONVERSATIONS_READ: 'conversations:read',
  CONVERSATIONS_REPLY: 'conversations:reply',

  AI_USE: 'ai:use',
  KNOWLEDGE_MANAGE: 'knowledge:manage',

  INTEGRATIONS_READ: 'integrations:read',
  INTEGRATIONS_MANAGE: 'integrations:manage',

  ANALYTICS_READ: 'analytics:read',

  SETTINGS_MANAGE: 'settings:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const P = PERMISSIONS;

const READ_ONLY: Permission[] = [
  P.DASHBOARD_VIEW,
  P.ACCOUNTS_READ,
  P.CAMPAIGNS_READ,
  P.LEADS_READ,
  P.CONVERSATIONS_READ,
  P.INTEGRATIONS_READ,
  P.ANALYTICS_READ,
];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== P.SETTINGS_MANAGE),
  MARKETING_OPERATOR: [
    ...READ_ONLY,
    P.LEADS_MANAGE,
    P.OUTREACH_WORK,
    P.CONVERSATIONS_REPLY,
    P.AI_USE,
  ],
  VIEWER: READ_ONLY,
};

/** Urutan hierarki role: angka lebih besar = lebih tinggi. */
export const ROLE_RANK: Record<RoleCode, number> = {
  VIEWER: 1,
  MARKETING_OPERATOR: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

/**
 * Seorang pengguna hanya boleh mengelola pengguna dengan role di bawahnya,
 * kecuali Super Admin yang boleh mengelola semua role.
 */
export function canManageRole(actor: RoleCode, target: RoleCode): boolean {
  if (actor === 'SUPER_ADMIN') return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
