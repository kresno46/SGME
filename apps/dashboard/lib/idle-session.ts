/** Human activity only: background polling and token refresh must not extend this timer. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;

export const idleSessionKey = (userId: string) => `mbg:session-activity:${userId}`;

export function readSessionActivity(userId: string): number | null {
  try {
    const raw = localStorage.getItem(idleSessionKey(userId));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeSessionActivity(userId: string, at: number) {
  try {
    localStorage.setItem(idleSessionKey(userId), String(at));
  } catch {
    // The current tab still uses its in-memory timer when storage is unavailable.
  }
}

/** Call only after successful authentication, including two-factor verification. */
export function startIdleSession(userId: string) {
  writeSessionActivity(userId, Date.now());
}
