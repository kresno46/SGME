'use client';

import { ROLE_LABELS } from '@smge/shared';
import Image from 'next/image';
import { LogOut, Menu, Monitor, Moon, Sun, UserCog, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { DataDisclaimer } from '@/components/data-disclaimer';
import { useAuth } from '@/hooks/use-auth';
import { CURRENT_PHASE, NAV_ITEMS } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <Image
        src="/logo.png"
        alt="Logo Marketing Bias Growth"
        width={64}
        height={64}
        className="size-10 shrink-0 object-contain"
        priority
      />
      <div className="leading-tight">
        <p className="text-sm font-semibold">Marketing Bias</p>
        <p className="text-xs text-muted-foreground">Growth</p>
      </div>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, user } = useAuth();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navigasi utama">
      {NAV_ITEMS.filter(
        (i) => can(i.permission) && (!i.superAdminOnly || user.role === 'SUPER_ADMIN'),
      ).map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-brand-text'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{item.title}</span>
            {item.phase > CURRENT_PHASE && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                F{item.phase}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function ThemeMenu() {
  const { setTheme, theme } = useTheme();
  // false saat render server, true di browser (menghindari hydration mismatch ikon tema)
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const Icon = !mounted ? Monitor : theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ganti tema">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme('light')}>
          <Sun /> Terang
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}>
          <Moon /> Gelap
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}>
          <Monitor /> Ikuti sistem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const initials = user.name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md p-1 pr-2 text-left hover:bg-accent"
          aria-label="Menu pengguna"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-brand-text">
            {initials}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block max-w-40 truncate text-sm font-medium">{user.name}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate">{user.name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserCog /> Profil & keamanan
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <LogOut /> Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <DataDisclaimer />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-sidebar p-4 shadow-xl animate-in slide-in-from-left">
            <div className="flex items-center justify-between">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Tutup menu"
              >
                <X />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">
              <DataDisclaimer />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Buka menu"
          >
            <Menu />
          </Button>
          <div className="flex-1" />
          <ThemeMenu />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
