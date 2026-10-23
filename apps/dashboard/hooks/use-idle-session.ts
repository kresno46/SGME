'use client';

import { useEffect, useRef, useState } from 'react';
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  idleSessionKey,
  readSessionActivity,
  writeSessionActivity,
} from '@/lib/idle-session';

export function useIdleSession(userId: string, logout: () => Promise<void>) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const continueSession = useRef(() => {});

  useEffect(() => {
    let lastActivity = readSessionActivity(userId);
    if (lastActivity === null) {
      lastActivity = Date.now();
      writeSessionActivity(userId, lastActivity);
    }
    let lastPublished = lastActivity;
    let stopped = false;

    const check = () => {
      if (stopped) return false;
      const stored = readSessionActivity(userId);
      if (stored === 0) lastActivity = 0;
      else if (stored !== null) lastActivity = Math.max(lastActivity!, stored);
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivity!);
      if (lastActivity === 0 || remaining <= 0) {
        stopped = true;
        setExpired(true);
        void logout();
        return false;
      }
      setRemainingSeconds(remaining <= IDLE_WARNING_MS ? Math.ceil(remaining / 1000) : null);
      return true;
    };

    const activity = () => {
      // Never revive a session after sleep, a background-tab pause, or another tab's logout.
      if (!check()) return;
      lastActivity = Date.now();
      if (lastActivity - lastPublished >= 1000) {
        writeSessionActivity(userId, lastActivity);
        lastPublished = lastActivity;
      }
      setRemainingSeconds(null);
    };
    continueSession.current = activity;
    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    const storage = (event: StorageEvent) => {
      if (event.key === idleSessionKey(userId)) check();
    };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1000);
    check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [userId, logout]);

  return { expired, remainingSeconds, continueSession: () => continueSession.current() };
}
