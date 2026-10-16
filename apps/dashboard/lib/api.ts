import type { ApiErrorBody } from '@smge/types';

/**
 * Klien HTTP ke API SMGE (lewat proxy same-origin /api).
 * - Cookie sesi httpOnly dikirim otomatis; token tidak pernah disentuh JavaScript.
 * - Header X-CSRF-Token diambil dari cookie smge_csrf untuk request yang mengubah data.
 * - Saat 401, refresh token dirotasi sekali (single-flight) lalu request diulang.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_REFRESH = [
  '/auth/login',
  '/auth/refresh',
  '/auth/2fa/verify',
  '/auth/forgot-password',
  '/auth/reset-password',
];

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= rawFetch('/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function rawFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (UNSAFE.has(method)) {
    const csrf = readCookie('smge_csrf');
    if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  return fetch(`/api${path}`, { ...init, method, headers, credentials: 'same-origin' });
}

/** Dipanggil saat sesi benar-benar berakhir (mis. untuk redirect ke halaman login). */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, init);

  if (res.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    await refreshSession();
    // Diulang walau refresh gagal: tab lain mungkin sudah merotasi cookie (race multi-tab).
    res = await rawFetch(path, init);
    if (res.status === 401) onSessionExpired?.();
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.message ?? `Terjadi kesalahan (${res.status})`, err.errors);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) => {
    const qs = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : '';
    return apiFetch<T>(qs ? `${path}?${qs}` : path);
  },
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  /** Upload multipart (mis. file CSV). Content-Type diatur otomatis oleh browser. */
  upload: <T>(path: string, form: FormData) => apiFetch<T>(path, { method: 'POST', body: form }),
};

/** URL unduhan (GET dengan cookie sesi), dipakai sebagai href tautan unduh. */
export function downloadUrl(path: string, params: Record<string, string | number | boolean | undefined | null>) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

/** Memetakan error validasi API ke field react-hook-form. */
export function applyServerErrors(
  error: unknown,
  setError: (name: never, e: { type: string; message: string }) => void,
): string | null {
  if (error instanceof ApiError && error.errors) {
    for (const [field, messages] of Object.entries(error.errors)) {
      setError(field as never, { type: 'server', message: messages[0] });
    }
  }
  return error instanceof Error ? error.message : 'Terjadi kesalahan';
}
