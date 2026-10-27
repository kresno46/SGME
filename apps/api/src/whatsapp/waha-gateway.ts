import { Logger } from '@nestjs/common';
import { env } from '../config/env';

/** Kegagalan memanggil WAHA. `code` aman dicatat: status HTTP atau alasan singkat, tanpa isi pesan. */
export class WahaError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface WahaSessionInfo {
  name: string;
  status: string;
  meId: string | null;
  mePushName: string | null;
  webhookCount: number;
  webhookEvents: string[];
}

export interface WahaContact {
  /** Digit nomor telepon (tanpa +) */
  phone: string;
  /** Nama tersimpan di ponsel, atau nama profil WhatsApp */
  name: string;
  /** true bila nama itu tersimpan di buku kontak ponsel; false bila hanya nama profil orang tersebut */
  saved: boolean;
  /** Digit LID kontak ini bila diketahui; chat berbentuk @lid dicocokkan ke nama lewat ini */
  lid?: string | null;
}

export interface WahaChatSummary {
  /** JID chat, mis. 6281…@c.us */
  id: string;
  name: string | null;
  /** Detik; waktu pesan terakhir bila diketahui */
  lastTimestamp: number | null;
}

export interface WahaGateway {
  getSession(name: string): Promise<WahaSessionInfo | null>;
  listSessions(): Promise<Map<string, WahaSessionInfo>>;
  createSession(name: string, config: Record<string, unknown>): Promise<void>;
  startSession(name: string): Promise<void>;
  stopSession(name: string): Promise<void>;
  logoutSession(name: string): Promise<void>;
  deleteSession(name: string): Promise<void>;
  getQr(name: string): Promise<{ image: Buffer; contentType: string }>;
  /** Mengembalikan ID pesan dari WAHA. */
  sendText(session: string, chatId: string, text: string): Promise<string>;
  sendSeen(session: string, chatId: string): Promise<void>;
  /** Digit nomor untuk sebuah LID, atau null bila WAHA tidak mengetahuinya. */
  resolveLid(session: string, lid: string): Promise<string | null>;
  /**
   * Kontak ponsel yang tersinkron ke WAHA. Melempar WahaError('http_400') bila sesi dibuat tanpa NOWEB store
   * (sinkronisasi kontak mati).
   */
  listContacts(session: string): Promise<WahaContact[]>;
  /**
   * Daftar chat dari NOWEB store (terbaru dulu). Melempar WahaError('http_400') bila sesi dibuat tanpa store.
   */
  listChats(session: string, limit: number): Promise<WahaChatSummary[]>;
  /** Pesan terakhir sebuah chat dari store, bentuknya sama dengan payload webhook `message` (tanpa unduh media). */
  listMessages(session: string, chatId: string, limit: number): Promise<unknown[]>;
  /** Apakah nomor terdaftar di WhatsApp; `chatId` adalah JID resmi dari WhatsApp. */
  checkNumber(session: string, phone: string): Promise<{ exists: boolean; chatId: string | null }>;
}

export const WAHA_GATEWAY = Symbol('WAHA_GATEWAY');

const SESSION_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const LID = /^[0-9]{5,30}@lid$/;
const PHONE_JID = /^([0-9]{7,20})@c\.us$/;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_QR_BYTES = 512 * 1024;
const MAX_CONTACTS = 5000;
const MAX_CONTACTS_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;

/** Membaca body sampai batas; lebih dari itu dianggap salah agar respons raksasa tidak memenuhi memori. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new WahaError('response_too_large');
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max) throw new WahaError('response_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseSession(raw: unknown): WahaSessionInfo {
  if (!raw || typeof raw !== 'object') throw new WahaError('response_invalid');
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') throw new WahaError('response_invalid');
  const me = r.me && typeof r.me === 'object' ? (r.me as Record<string, unknown>) : null;
  const config =
    r.config && typeof r.config === 'object' ? (r.config as Record<string, unknown>) : {};
  const hooks = Array.isArray(config.webhooks) ? config.webhooks : [];
  const events = new Set<string>();
  for (const hook of hooks) {
    const list = (hook as { events?: unknown } | null)?.events;
    if (Array.isArray(list)) for (const ev of list) if (typeof ev === 'string') events.add(ev);
  }
  return {
    name: r.name,
    status: typeof r.status === 'string' && r.status ? r.status : 'UNKNOWN',
    meId: me && typeof me.id === 'string' ? me.id : null,
    mePushName: me && typeof me.pushName === 'string' ? me.pushName : null,
    webhookCount: hooks.length,
    webhookEvents: [...events].sort(),
  };
}

/** Klien HTTP WAHA: tanpa redirect (kunci API tidak boleh ikut ke alamat lain), ada batas waktu dan ukuran. */
export class HttpWahaGateway implements WahaGateway {
  private readonly logger = new Logger('Waha');

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  private path(name: string) {
    if (!SESSION_NAME.test(name)) throw new WahaError('invalid_session_name');
    return encodeURIComponent(name);
  }

  private async call(
    method: string,
    path: string,
    opts: { body?: unknown; maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<{ status: number; raw: Buffer; contentType: string }> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
        headers: {
          'X-Api-Key': this.apiKey,
          Accept: 'application/json, image/*',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const raw = await readCapped(res, opts.maxBytes ?? MAX_JSON_BYTES);
      return { status: res.status, raw, contentType: res.headers.get('content-type') ?? '' };
    } catch (e) {
      if (e instanceof WahaError) throw e;
      // Isi pesan dan URL tidak ikut dicatat.
      this.logger.warn(`Panggilan WAHA ${method} gagal: ${(e as Error).name}`);
      // Waktu habis berbeda dari tak terjangkau: WAHA menjawab, hanya lambat, dan pesan bisa saja sudah terkirim.
      throw new WahaError((e as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
  }

  private json(raw: Buffer): unknown {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw new WahaError('response_invalid');
    }
  }

  /** 422 dari WAHA berarti "sudah ada / sudah berjalan", bukan kegagalan. */
  private async action(method: string, path: string, body?: unknown, tolerate: number[] = [422]) {
    const { status } = await this.call(method, path, { body });
    if (!(status >= 200 && status < 300) && !tolerate.includes(status))
      throw new WahaError(`http_${status}`);
  }

  async getSession(name: string) {
    const { status, raw } = await this.call('GET', `/api/sessions/${this.path(name)}`);
    if (status === 404) return null;
    if (status !== 200) throw new WahaError(`http_${status}`);
    const session = parseSession(this.json(raw));
    if (session.name !== name) throw new WahaError('response_invalid');
    return session;
  }

  async listSessions() {
    const { status, raw } = await this.call('GET', '/api/sessions?all=true');
    if (status !== 200) throw new WahaError(`http_${status}`);
    const parsed = this.json(raw);
    if (!Array.isArray(parsed)) throw new WahaError('response_invalid');
    return new Map(parsed.map((e) => parseSession(e)).map((s) => [s.name, s] as const));
  }

  async createSession(name: string, config: Record<string, unknown>) {
    this.path(name);
    await this.action('POST', '/api/sessions', { name, start: false, config });
  }
  async startSession(name: string) {
    await this.action('POST', `/api/sessions/${this.path(name)}/start`, {});
  }
  async stopSession(name: string) {
    await this.action('POST', `/api/sessions/${this.path(name)}/stop`, {});
  }
  async logoutSession(name: string) {
    await this.action('POST', `/api/sessions/${this.path(name)}/logout`, {});
  }
  async deleteSession(name: string) {
    await this.action('DELETE', `/api/sessions/${this.path(name)}`, undefined, [404]);
  }

  async getQr(name: string) {
    const { status, raw, contentType } = await this.call(
      'GET',
      `/api/${this.path(name)}/auth/qr?format=image`,
      { maxBytes: MAX_QR_BYTES },
    );
    if (status !== 200) throw new WahaError(`http_${status}`);
    if (!contentType.toLowerCase().startsWith('image/'))
      throw new WahaError('qr_unexpected_content');
    return { image: raw, contentType: contentType.split(';')[0].trim() };
  }

  async sendText(session: string, chatId: string, text: string) {
    this.path(session);
    const { status, raw } = await this.call('POST', '/api/sendText', {
      body: { session, chatId, text },
    });
    if (status < 200 || status >= 300) throw new WahaError(`http_${status}`);
    const id = parseMessageId(this.json(raw));
    if (!id) throw new WahaError('response_without_message_id');
    return id;
  }

  async sendSeen(session: string, chatId: string) {
    this.path(session);
    await this.action('POST', '/api/sendSeen', { session, chatId }, []);
  }

  async resolveLid(session: string, lid: string) {
    if (!LID.test(lid)) return null;
    const { status, raw } = await this.call(
      'GET',
      `/api/${this.path(session)}/lids/${encodeURIComponent(lid)}`,
      { timeoutMs: Math.min(3000, this.timeoutMs) },
    );
    if (status === 404) return null;
    if (status !== 200) throw new WahaError(`http_${status}`);
    const pn = (this.json(raw) as { pn?: unknown } | null)?.pn;
    const m = typeof pn === 'string' ? PHONE_JID.exec(pn) : null;
    return m ? m[1] : null;
  }

  async listContacts(session: string) {
    const { status, raw } = await this.call(
      'GET',
      `/api/contacts/all?session=${this.path(session)}&limit=${MAX_CONTACTS}&offset=0&sortBy=name&sortOrder=asc`,
      { maxBytes: MAX_CONTACTS_BYTES, timeoutMs: Math.max(this.timeoutMs, 20_000) },
    );
    if (status !== 200) throw new WahaError(`http_${status}`);
    return parseContacts(this.json(raw));
  }

  async listChats(session: string, limit: number) {
    const { status, raw } = await this.call(
      'GET',
      `/api/${this.path(session)}/chats?limit=${limit}&offset=0&sortBy=conversationTimestamp&sortOrder=desc`,
      { maxBytes: MAX_HISTORY_BYTES, timeoutMs: Math.max(this.timeoutMs, 30_000) },
    );
    if (status !== 200) throw new WahaError(`http_${status}`);
    return parseChats(this.json(raw));
  }

  async listMessages(session: string, chatId: string, limit: number) {
    const { status, raw } = await this.call(
      'GET',
      `/api/${this.path(session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=0&downloadMedia=false&sortBy=timestamp&sortOrder=desc`,
      { maxBytes: MAX_HISTORY_BYTES, timeoutMs: Math.max(this.timeoutMs, 30_000) },
    );
    if (status !== 200) throw new WahaError(`http_${status}`);
    const parsed = this.json(raw);
    if (!Array.isArray(parsed)) throw new WahaError('response_invalid');
    return parsed;
  }

  async checkNumber(session: string, phone: string) {
    if (!/^\d{7,20}$/.test(phone)) throw new WahaError('invalid_phone');
    const { status, raw } = await this.call(
      'GET',
      `/api/contacts/check-exists?phone=${phone}&session=${this.path(session)}`,
      { timeoutMs: Math.max(this.timeoutMs, 15_000) },
    );
    if (status !== 200) throw new WahaError(`http_${status}`);
    const r = this.json(raw) as { numberExists?: unknown; chatId?: unknown } | null;
    const exists = r?.numberExists === true;
    return { exists, chatId: exists && typeof r?.chatId === 'string' ? r.chatId : null };
  }
}

/** Ringkasan chat dari respons WAHA. Bentuk bisa berbeda antar versi, jadi tiap field dibaca defensif. */
export function parseChats(raw: unknown): WahaChatSummary[] {
  if (!Array.isArray(raw)) throw new WahaError('response_invalid');
  const out: WahaChatSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    const idField = c.id;
    const id =
      typeof idField === 'string'
        ? idField
        : idField &&
            typeof idField === 'object' &&
            typeof (idField as { _serialized?: unknown })._serialized === 'string'
          ? (idField as { _serialized: string })._serialized
          : null;
    if (!id) continue;
    const inner =
      c._chat && typeof c._chat === 'object' ? (c._chat as Record<string, unknown>) : {};
    const last =
      c.lastMessage && typeof c.lastMessage === 'object'
        ? (c.lastMessage as Record<string, unknown>)
        : {};
    const ts = [c.conversationTimestamp, inner.conversationTimestamp, last.timestamp]
      .map((v) => (typeof v === 'string' && v.trim() ? Number(v) : v))
      .find((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    out.push({
      // NOWEB mengembalikan JID mentah Baileys (`…@s.whatsapp.net`); seluruh SMGE memakai bentuk WAHA (`…@c.us`).
      id: id.replace(/@s\.whatsapp\.net$/, '@c.us'),
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 100) : null,
      // Milidetik bila lebih dari 1e11 (tahun 5138 dalam detik).
      lastTimestamp: ts === undefined ? null : ts > 100_000_000_000 ? Math.floor(ts / 1000) : ts,
    });
  }
  return out;
}

/**
 * Kontak 1:1 dari respons WAHA; grup, diri sendiri, dan entri tanpa nama atau nomor dilewati. Kontak berbentuk
 * `@lid` dipetakan ke nomor lewat `phoneNumber`; satu orang yang muncul dua kali digabung (nomor sama).
 */
export function parseContacts(raw: unknown): WahaContact[] {
  if (!Array.isArray(raw)) throw new WahaError('response_invalid');
  const PHONE = /^(\d{7,20})@(?:c\.us|s\.whatsapp\.net)$/;
  const LID_JID = /^(\d{5,30})@lid$/;
  const byPhone = new Map<string, WahaContact>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const c = entry as Record<string, unknown>;
    if (c.isMe === true || c.isGroup === true || typeof c.id !== 'string') continue;
    const name = [c.name, c.pushname, c.shortName].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    if (!name) continue;
    const saved = typeof c.name === 'string' && c.name.trim().length > 0;
    const phone =
      PHONE.exec(c.id)?.[1] ??
      (typeof c.phoneNumber === 'string' ? PHONE.exec(c.phoneNumber)?.[1] : undefined);
    if (!phone) continue;
    const lidSource = c.id.endsWith('@lid') ? c.id : typeof c.lid === 'string' ? c.lid : '';
    const lid = LID_JID.exec(lidSource)?.[1] ?? null;
    const known = byPhone.get(phone);
    if (known) {
      known.lid ??= lid;
      // Entri ganda: nama tersimpan menggantikan nama profil.
      if (saved && !known.saved)
        Object.assign(known, { name: name.trim().slice(0, 100), saved: true });
    } else byPhone.set(phone, { phone, name: name.trim().slice(0, 100), saved, lid });
  }
  return [...byPhone.values()];
}

/** ID pesan dari respons kirim. Bentuknya berbeda antar engine dan versi WAHA. */
export function parseMessageId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id === 'string' && r.id) return r.id;
  if (r.id && typeof r.id === 'object') {
    const o = r.id as Record<string, unknown>;
    for (const k of ['_serialized', 'id'])
      if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  const key = r.key as { id?: unknown } | undefined;
  return key && typeof key.id === 'string' && key.id ? key.id : null;
}

export function createWahaGateway(): WahaGateway | null {
  const e = env();
  if (!e.WAHA_ENABLED || !e.WAHA_BASE_URL || !e.WAHA_API_KEY) return null;
  const base = e.WAHA_BASE_URL.replace(/\/+$/, '');
  return new HttpWahaGateway(base, e.WAHA_API_KEY, e.WAHA_TIMEOUT_MS);
}
