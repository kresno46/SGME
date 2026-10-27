'use client';

import { PERMISSIONS, type Permission } from '@smge/shared';
import type { AuthUser } from '@smge/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { api, apiFetch, setSessionExpiredHandler } from '@/lib/api';
import { writeSessionActivity } from '@/lib/idle-session';
import { Button } from '@/components/ui/button';
import { useIdleSession } from './use-idle-session';

interface AuthContextValue {
  user: AuthUser;
  can: (permission: Permission) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_MANAGEMENT: readonly string[] = [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_MANAGE];
const SUPER_ADMIN_ONLY: readonly string[] = [
  PERMISSIONS.ROLES_READ,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.KNOWLEDGE_MANAGE,
  PERMISSIONS.DNC_MANAGE,
];

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<AuthUser>('/auth/me'),
    staleTime: 60_000,
  });
}

export function AuthProvider({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const qc = useQueryClient();
  const loggingOut = useRef<Promise<void> | null>(null);

  const logout = useCallback(() => {
    if (loggingOut.current) return loggingOut.current;
    writeSessionActivity(user.id, 0);
    loggingOut.current = (async () => {
      // Bound the entire operation, including a shared refresh request after a 401.
      // Aborting only the logout fetch does not stop an unresponsive token refresh.
      const controller = new AbortController();
      await new Promise<void>((resolve) => {
        const deadline = window.setTimeout(() => {
          controller.abort();
          resolve();
        }, 5000);
        void apiFetch('/auth/logout', { method: 'POST', signal: controller.signal })
          .catch(() => undefined)
          .finally(() => {
            window.clearTimeout(deadline);
            resolve();
          });
      });
      qc.clear();
      window.location.replace('/login?reason=session-ended');
    })();
    return loggingOut.current;
  }, [qc, user.id]);
  const idle = useIdleSession(user.id, logout);

  // Use the same bounded logout on authentication failure. The explicit login reason
  // avoids middleware sending an expired-cookie session back to the dashboard.
  useEffect(() => setSessionExpiredHandler(() => void logout()), [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      can: (p) =>
        user.permissions.includes(p) &&
        (!USER_MANAGEMENT.includes(p) ||
          user.role === 'SUPER_ADMIN' ||
          user.role === 'ADMIN') &&
        (user.role === 'SUPER_ADMIN' || !SUPER_ADMIN_ONLY.includes(p)),
      logout,
    }),
    [user, logout],
  );

  return (
    <AuthContext.Provider value={value}>
      {idle.expired ? (
        <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
          Sesi berakhir karena tidak ada aktivitas. Mengarahkan ke halaman login…
        </div>
      ) : (
        <>
          {children}
          {idle.remainingSeconds !== null && (
            <div
              role="alert"
              className="fixed bottom-4 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg"
            >
              <p className="text-sm">
                Tidak ada aktivitas. Anda akan keluar dalam {idle.remainingSeconds} detik.
              </p>
              <Button onClick={idle.continueSession}>Tetap masuk</Button>
            </div>
          )}
        </>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
