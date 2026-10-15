'use client';

import type { Permission } from '@smge/shared';
import type { AuthUser } from '@smge/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { api, setSessionExpiredHandler } from '@/lib/api';

interface AuthContextValue {
  user: AuthUser;
  can: (permission: Permission) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<AuthUser>('/auth/me'),
    staleTime: 60_000,
  });
}

export function AuthProvider({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();

  const redirectToLogin = useCallback(() => {
    qc.clear();
    const next =
      window.location.pathname === '/'
        ? ''
        : `?next=${encodeURIComponent(window.location.pathname)}`;
    router.replace(`/login${next}`);
  }, [qc, router]);

  useEffect(() => setSessionExpiredHandler(redirectToLogin), [redirectToLogin]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      can: (p) => user.permissions.includes(p),
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        qc.clear();
        router.replace('/login');
      },
    }),
    [user, qc, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
