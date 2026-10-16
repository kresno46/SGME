import { PERMISSIONS, type Permission } from '@smge/shared';
import {
  BarChart3,
  Bot,
  Cable,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Send,
  Settings,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
  /** Fase pengembangan saat modul tersedia penuh */
  phase: number;
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    permission: PERMISSIONS.DASHBOARD_VIEW,
    phase: 1,
  },
  {
    title: 'Akun TikTok',
    href: '/accounts',
    icon: Smartphone,
    permission: PERMISSIONS.ACCOUNTS_READ,
    phase: 1,
  },
  {
    title: 'Campaign',
    href: '/campaigns',
    icon: Megaphone,
    permission: PERMISSIONS.CAMPAIGNS_READ,
    phase: 2,
  },
  {
    title: 'CRM / Prospek',
    href: '/leads',
    icon: Users,
    permission: PERMISSIONS.LEADS_READ,
    phase: 2,
  },
  {
    title: 'Outbound Workstation',
    href: '/outbound',
    icon: Send,
    permission: PERMISSIONS.OUTREACH_WORK,
    phase: 2,
  },
  {
    title: 'AI Sales Agent',
    href: '/ai-sales',
    icon: Bot,
    permission: PERMISSIONS.AI_USE,
    phase: 3,
  },
  {
    title: 'Percakapan',
    href: '/conversations',
    icon: MessagesSquare,
    permission: PERMISSIONS.CONVERSATIONS_READ,
    phase: 4,
  },
  {
    title: 'Analitik',
    href: '/analytics',
    icon: BarChart3,
    permission: PERMISSIONS.ANALYTICS_READ,
    phase: 5,
  },
  {
    title: 'Integrasi',
    href: '/integrations',
    icon: Cable,
    permission: PERMISSIONS.INTEGRATIONS_READ,
    phase: 4,
  },
  {
    title: 'Pengaturan',
    href: '/settings',
    icon: Settings,
    permission: PERMISSIONS.DASHBOARD_VIEW,
    phase: 1,
  },
];

export const CURRENT_PHASE = 3;
