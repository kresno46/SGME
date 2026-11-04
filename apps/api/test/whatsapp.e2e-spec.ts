import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { resetEnvCache } from '../src/config/env';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  WahaError,
  type WahaChatSummary,
  type WahaContact,
  type WahaGateway,
  type WahaSessionInfo,
} from '../src/whatsapp/waha-gateway';
import { WhatsappBroadcastService } from '../src/whatsapp/whatsapp-broadcast.service';
import { WhatsappHistoryService } from '../src/whatsapp/whatsapp-history.service';
import { WhatsappMonitorService } from '../src/whatsapp/whatsapp-monitor.service';
import { deriveWebhookSecret } from '../src/whatsapp/waha-signature';
import { createTestApp, loginAs, resetDatabase, type Session } from './utils';

const MASTER = process.env.WAHA_WEBHOOK_MASTER_SECRET!;
const CUSTOMER = '6281234567890@c.us';
/** Nama sesi bentuk benar tetapi tanpa baris di database. */
const ghostName = (n: number) => `u-${'0'.repeat(31)}${n}-00000000`;

/** Gateway WAHA palsu di memori: tidak ada panggilan jaringan, tidak ada pesan WhatsApp sungguhan. */
class FakeWaha implements WahaGateway {
  sessions = new Map<string, WahaSessionInfo>();
  created: Array<{ name: string; config: Record<string, unknown> }> = [];
  sent: Array<{ session: string; chatId: string; text: string }> = [];
  deleted: string[] = [];
  contacts: Array<Omit<WahaContact, 'saved'> & { saved?: boolean }> = [];
  contactsAvailable = true;
  unregistered = new Set<string>();
  chats: WahaChatSummary[] = [];
  history: Record<string, unknown[]> = {};
  storeEnabled = true;
  listChatsCalls = 0;
  seen: string[] = [];
  failNextSend: string | null = null;
  unreachable = false;
  seq = 0;

  private guard() {
    if (this.unreachable) throw new WahaError('unreachable');
  }
  async getSession(name: string) {
    this.guard();
    return this.sessions.get(name) ?? null;
  }
  async listSessions() {
    this.guard();
    return new Map(this.sessions);
  }
  async createSession(name: string, config: Record<string, unknown>) {
    this.guard();
    this.created.push({ name, config });
    if (!this.sessions.has(name))
      this.sessions.set(name, {
        name,
        status: 'STOPPED',
        meId: null,
        mePushName: null,
        webhookCount: 1,
        webhookEvents: ['message', 'message.any', 'message.ack', 'session.status'],
      });
  }
  private set(name: string, patch: Partial<WahaSessionInfo>) {
    const s = this.sessions.get(name);
    if (s) this.sessions.set(name, { ...s, ...patch });
  }
  async startSession(name: string) {
    this.set(name, { status: 'SCAN_QR_CODE' });
  }
  async stopSession(name: string) {
    this.set(name, { status: 'STOPPED' });
  }
  async logoutSession(name: string) {
    this.set(name, { status: 'STOPPED', meId: null, mePushName: null });
  }
  async deleteSession(name: string) {
    this.deleted.push(name);
    this.sessions.delete(name);
  }
  async getQr() {
    return { image: Buffer.from('89504e47', 'hex'), contentType: 'image/png' };
  }
  async sendText(session: string, chatId: string, text: string) {
    this.guard();
    if (this.failNextSend) {
      const code = this.failNextSend;
      this.failNextSend = null;
      throw new WahaError(code);
    }
    this.sent.push({ session, chatId, text });
    return `3EB0FAKE${++this.seq}`;
  }
  async sendSeen(_session: string, chatId: string) {
    this.seen.push(chatId);
  }
  async resolveLid() {
    return null;
  }
  async listContacts() {
    this.guard();
    if (!this.contactsAvailable) throw new WahaError('http_400');
    return this.contacts.map((c) => ({ saved: true, ...c }));
  }
  async listChats() {
    this.guard();
    this.listChatsCalls++;
    if (!this.storeEnabled) throw new WahaError('http_400');
    return this.chats;
  }
  async listMessages(_session: string, chatId: string) {
    this.guard();
    return this.history[chatId] ?? [];
  }
  async checkNumber(_session: string, phone: string) {
    this.guard();
    const exists = !this.unregistered.has(phone);
    return { exists, chatId: exists ? `${phone}@c.us` : null };
  }
  link(name: string) {
    this.set(name, { status: 'WORKING', meId: '628111222333@c.us', mePushName: 'Nomor Uji' });
  }
}

describe('WhatsApp (WAHA)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let waha: FakeWaha;
  let operator: Session;
  let operatorId: string;
  /** Nomor terakhir yang dibuat lewat addNumber/linkOperator */
  let sessionId: string;
  let sessionName: string;

  const post = (s: Session, path: string, body?: object) =>
    s.agent.post(`/api/whatsapp${path}`).set('x-csrf-token', s.csrf).send(body);

  /** Webhook bertanda tangan seperti WAHA (HMAC-SHA512 atas body mentah). */
  async function hook(
    event: string,
    payload: object,
    opts: { key?: string; secretFor?: string; tamper?: boolean } = {},
  ) {
    const key = opts.key ?? sessionName;
    const body = JSON.stringify({ event, session: key, payload });
    const sig = createHmac('sha512', deriveWebhookSecret(MASTER, opts.secretFor ?? key))
      .update(body)
      .digest('hex');
    const req = (await import('supertest'))
      .default(app.getHttpServer())
      .post(`/api/webhooks/waha/${key}`)
      .set('Content-Type', 'application/json');
    if (opts.tamper !== true) req.set('X-Webhook-Hmac', sig);
    return req.send(body);
  }
  const inbound = (id: string, body: string, extra: object = {}) => ({
    id: `false_${CUSTOMER}_${id}`,
    timestamp: Math.floor(Date.now() / 1000),
    from: CUSTOMER,
    fromMe: false,
    body,
    hasMedia: false,
    _data: { pushName: 'Budi' },
    ...extra,
  });

  beforeAll(async () => {
    waha = new FakeWaha();
    ({ app, prisma } = await createTestApp({ waha }));
  });
  beforeEach(async () => {
    waha.sessions.clear();
    waha.created = [];
    waha.sent = [];
    waha.deleted = [];
    waha.contacts = [];
    waha.contactsAvailable = true;
    waha.unregistered = new Set();
    waha.chats = [];
    waha.history = {};
    waha.storeEnabled = true;
    waha.listChatsCalls = 0;
    waha.seen = [];
    waha.seq = 0;
    waha.failNextSend = null;
    waha.unreachable = false;
    await resetDatabase(prisma);
    operator = await loginAs(app, 'MARKETING_OPERATOR');
    operatorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'operator@test.local' } }))
      .id;
  });
  afterAll(() => app.close());

  /** Menambah nomor lewat API; nomor terakhir menjadi `sessionId`/`sessionName` (target webhook default). */
  async function addNumber(label = 'Nomor 1', who: Session = operator) {
    const res = await post(who, '/sessions', { label }).expect(200);
    const row = await prisma.wahaSession.findUniqueOrThrow({ where: { id: res.body.id } });
    sessionId = row.id;
    sessionName = row.sessionName;
    return { id: row.id, name: row.sessionName, body: res.body };
  }
  async function linkOperator(label = 'Nomor 1') {
    const n = await addNumber(label);
    waha.link(n.name);
    return n;
  }
  async function firstChat() {
    await linkOperator();
    await hook('message', inbound('A1', 'Halo, mau tanya produk')).then((r) =>
      expect(r.status).toBe(200),
    );
    return prisma.whatsappChat.findFirstOrThrow({ where: { ownerId: operatorId } });
  }

  describe('akses & sesi', () => {
    it('menolak role tanpa izin dan yang belum login', async () => {
      const viewer = await loginAs(app, 'VIEWER');
      await viewer.agent.get('/api/whatsapp/sessions').expect(403);
      await viewer.agent.get('/api/whatsapp/chats').expect(403);
      await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .get('/api/whatsapp/sessions')
        .expect(401);
      const mine = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(mine.body).toEqual([]);
    });

    it('membuat nomor milik user dengan webhook bertanda tangan turunan, dan start idempoten', async () => {
      const res = await post(operator, '/sessions', { label: 'CS 1' }).expect(200);
      expect(res.body).toMatchObject({ label: 'CS 1', status: 'SCAN_QR_CODE', chatCount: 0 });
      const row = await prisma.wahaSession.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row.sessionName).toMatch(/^u-[0-9a-f]{32}-[0-9a-f]{8}$/);
      expect(row.sessionName.slice(2, 34)).toBe(operatorId.replaceAll('-', ''));
      await post(operator, `/sessions/${row.id}/start`).expect(200);
      expect(await prisma.wahaSession.count()).toBe(1);
      const cfg = waha.created[0];
      expect(cfg.name).toBe(row.sessionName);
      const hooks = cfg.config.webhooks as Array<{
        url: string;
        hmac: { key: string };
        events: string[];
      }>;
      expect(hooks[0].url).toBe(`https://smge.test/api/webhooks/waha/${row.sessionName}`);
      expect(hooks[0].hmac.key).toBe(deriveWebhookSecret(MASTER, row.sessionName));
      expect(hooks[0].events).toEqual(
        expect.arrayContaining(['message', 'message.ack', 'session.status']),
      );
      const qr = await operator.agent.get(`/api/whatsapp/sessions/${row.id}/qr`).expect(200);
      expect(qr.headers['content-type']).toMatch(/image\/png/);
      expect(qr.headers['cache-control']).toMatch(/no-store/);
    });

    it('menyamarkan nomor tertaut dan tetap menjawab saat WAHA tidak terjangkau', async () => {
      await linkOperator();
      const ok = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(ok.body[0]).toMatchObject({ status: 'WORKING', connectedNumber: '+62••••••2333' });
      expect(JSON.stringify(ok.body)).not.toContain('628111222333');
      waha.unreachable = true;
      const down = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(down.body[0]).toMatchObject({ status: 'UNREACHABLE', problem: 'unreachable' });
    });

    it('atur ulang ditolak saat nomor tersambung', async () => {
      const n = await linkOperator();
      await post(operator, `/sessions/${n.id}/reset`).expect(409);
    });

    it('daftar semua nomor hanya untuk Super Admin', async () => {
      await linkOperator();
      await operator.agent.get('/api/whatsapp/admin/sessions').expect(403);
      const admin = await loginAs(app, 'ADMIN');
      await admin.agent.get('/api/whatsapp/admin/sessions').expect(403);
      const root = await loginAs(app, 'SUPER_ADMIN');
      const list = await root.agent.get('/api/whatsapp/admin/sessions').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        sessionId,
        label: 'Nomor 1',
        userId: operatorId,
        status: 'WORKING',
      });
      await post(root, `/admin/sessions/${sessionId}/logout`).expect(200);
      expect(waha.sessions.get(sessionName)?.meId).toBeNull();
      await post(operator, `/admin/sessions/${sessionId}/stop`).expect(403);
    });

    it('config melaporkan batas nomor per user', async () => {
      const cfg = await operator.agent.get('/api/whatsapp/config').expect(200);
      expect(cfg.body).toEqual({
        enabled: true,
        maxSessionsPerUser: 3,
        singleSession: false,
        contactsSync: false,
        newChatsPerDay: 20,
        historySync: true,
        historyDays: 30,
        broadcast: {
          enabled: true,
          maxRecipients: 50,
          perDay: 30,
          minDelaySeconds: 20,
          maxDelaySeconds: 60,
        },
      });
    });
  });

  describe('banyak nomor per user', () => {
    it('satu user menambah beberapa nomor sampai batas, masing-masing bersesi sendiri', async () => {
      const a = await addNumber('CS 1');
      const b = await addNumber('CS 2');
      const c = await addNumber('CS 3');
      expect(new Set([a.name, b.name, c.name]).size).toBe(3);
      const over = await post(operator, '/sessions', { label: 'CS 4' }).expect(409);
      expect(over.body.message).toMatch(/Maksimal 3/);
      const list = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(list.body.map((s: { label: string }) => s.label)).toEqual(['CS 1', 'CS 2', 'CS 3']);
      // Batas berlaku per user: user lain tidak terpengaruh.
      const admin = await loginAs(app, 'ADMIN');
      await post(admin, '/sessions', { label: 'Admin 1' }).expect(200);
    });

    it('memvalidasi nama nomor', async () => {
      await post(operator, '/sessions', { label: '   ' }).expect(400);
      await post(operator, '/sessions', { label: 'x'.repeat(41) }).expect(400);
      await post(operator, '/sessions', {}).expect(400);
      expect(await prisma.wahaSession.count()).toBe(0);
    });

    it('chat dari pelanggan yang sama di dua nomor adalah dua chat terpisah, bisa difilter per nomor', async () => {
      const a = await linkOperator('CS 1');
      const b = await linkOperator('CS 2');
      await hook('message', inbound('M1', 'ke nomor A'), { key: a.name });
      await hook('message', inbound('M2', 'ke nomor B'), { key: b.name });
      expect(await prisma.whatsappChat.count()).toBe(2);

      const all = await operator.agent.get('/api/whatsapp/chats').expect(200);
      expect(all.body.total).toBe(2);
      expect(
        all.body.items.map((c: { session: { label: string } }) => c.session.label).sort(),
      ).toEqual(['CS 1', 'CS 2']);
      const onlyB = await operator.agent.get(`/api/whatsapp/chats?sessionId=${b.id}`).expect(200);
      expect(onlyB.body.total).toBe(1);
      expect(onlyB.body.items[0]).toMatchObject({
        lastMessagePreview: 'ke nomor B',
        session: { id: b.id, label: 'CS 2' },
      });
    });

    it('balasan selalu keluar dari nomor tempat chat itu berada', async () => {
      const a = await linkOperator('CS 1');
      const b = await linkOperator('CS 2');
      await hook('message', inbound('M1', 'ke A'), { key: a.name });
      await hook('message', inbound('M2', 'ke B'), { key: b.name });
      const chatB = await prisma.whatsappChat.findFirstOrThrow({ where: { sessionId: b.id } });
      const chatA = await prisma.whatsappChat.findFirstOrThrow({ where: { sessionId: a.id } });
      await post(operator, `/chats/${chatB.id}/send`, {
        text: 'balas dari B',
        clientMessageId: 'client-b-001',
      }).expect(200);
      await post(operator, `/chats/${chatA.id}/send`, {
        text: 'balas dari A',
        clientMessageId: 'client-a-001',
      }).expect(200);
      expect(waha.sent.map((m) => [m.session, m.text])).toEqual([
        [b.name, 'balas dari B'],
        [a.name, 'balas dari A'],
      ]);
    });

    it('hanya pemilik yang dapat mengelola nomornya; milik orang lain dianggap tidak ada', async () => {
      const n = await linkOperator('CS 1');
      for (const who of [await loginAs(app, 'ADMIN'), await loginAs(app, 'SUPER_ADMIN')]) {
        await post(who, `/sessions/${n.id}/start`).expect(404);
        await post(who, `/sessions/${n.id}/stop`).expect(404);
        await post(who, `/sessions/${n.id}/logout`).expect(404);
        await post(who, `/sessions/${n.id}/reset`).expect(404);
        await who.agent.get(`/api/whatsapp/sessions/${n.id}/qr`).expect(404);
        await who.agent
          .patch(`/api/whatsapp/sessions/${n.id}`)
          .set('x-csrf-token', who.csrf)
          .send({ label: 'curian' })
          .expect(404);
        await who.agent
          .delete(`/api/whatsapp/sessions/${n.id}`)
          .set('x-csrf-token', who.csrf)
          .expect(404);
        expect((await who.agent.get('/api/whatsapp/sessions').expect(200)).body).toEqual([]);
      }
      expect((await prisma.wahaSession.findUniqueOrThrow({ where: { id: n.id } })).label).toBe(
        'CS 1',
      );
      expect(waha.sessions.get(n.name)?.status).toBe('WORKING');
    });

    it('mengganti nama nomor', async () => {
      const n = await addNumber('CS 1');
      const res = await operator.agent
        .patch(`/api/whatsapp/sessions/${n.id}`)
        .set('x-csrf-token', operator.csrf)
        .send({ label: 'CS Utama' })
        .expect(200);
      expect(res.body).toMatchObject({ id: n.id, label: 'CS Utama' });
      await operator.agent
        .patch(`/api/whatsapp/sessions/${n.id}`)
        .set('x-csrf-token', operator.csrf)
        .send({ label: '' })
        .expect(400);
    });

    it('menghapus nomor hanya bila belum tersambung dan tanpa chat', async () => {
      const del = (id: string) =>
        operator.agent.delete(`/api/whatsapp/sessions/${id}`).set('x-csrf-token', operator.csrf);
      const connected = await linkOperator('Tersambung');
      expect((await del(connected.id).expect(409)).body.message).toMatch(/tersambung/);

      await post(operator, `/sessions/${connected.id}/logout`).expect(200);
      await hook('message', inbound('D1', 'ada chat'), { key: connected.name });
      expect((await del(connected.id).expect(409)).body.message).toMatch(/chat tersimpan/);

      const empty = await addNumber('Kosong');
      await del(empty.id).expect(200);
      expect(waha.deleted).toEqual([empty.name]);
      expect(await prisma.wahaSession.findUnique({ where: { id: empty.id } })).toBeNull();
      // Nomor yang punya chat tetap utuh beserta isinya.
      expect(await prisma.whatsappMessage.count()).toBe(1);
      // Slot yang dibebaskan bisa dipakai lagi.
      await post(operator, '/sessions', { label: 'Pengganti' }).expect(200);
    });

    it('spanduk terputus menyebut nomor yang terputus saja', async () => {
      const a = await linkOperator('CS 1');
      await linkOperator('CS 2');
      await hook('session.status', { status: 'WORKING' }, { key: a.name });
      await hook('session.status', { status: 'STOPPED' }, { key: a.name });
      // WAHA sungguhan ikut melaporkan STOPPED; tanpa ini daftar membaca WORKING dan menghapus penanda putus.
      waha.sessions.set(a.name, { ...waha.sessions.get(a.name)!, status: 'STOPPED' });
      const health = await operator.agent.get('/api/whatsapp/sessions/health').expect(200);
      expect(health.body).toEqual({ linked: true, connectionLost: true, lostLabels: ['CS 1'] });
      const list = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(
        list.body.map((s: { label: string; connectionLost: boolean }) => [
          s.label,
          s.connectionLost,
        ]),
      ).toEqual([
        ['CS 1', true],
        ['CS 2', false],
      ]);
    });

    it('Super Admin melihat semua nomor dan dapat menghentikan satu nomor tertentu', async () => {
      const a = await linkOperator('CS 1');
      const b = await linkOperator('CS 2');
      const root = await loginAs(app, 'SUPER_ADMIN');
      const list = await root.agent.get('/api/whatsapp/admin/sessions').expect(200);
      expect(list.body.map((s: { label: string }) => s.label)).toEqual(['CS 1', 'CS 2']);
      await post(root, `/admin/sessions/${a.id}/stop`).expect(200);
      expect(waha.sessions.get(a.name)?.status).toBe('STOPPED');
      expect(waha.sessions.get(b.name)?.status).toBe('WORKING');
    });
  });

  describe('webhook', () => {
    beforeEach(async () => {
      await linkOperator();
    });

    it('menolak tanpa tanda tangan, tanda tangan salah, dan kunci tak dikenal dengan pesan sama', async () => {
      const other = ghostName(2);
      const a = await hook('message', inbound('X1', 'hai'), { tamper: true });
      // Tanda tangan sesi lain dipakai untuk sesi ini.
      const b = await hook('message', inbound('X1', 'hai'), { secretFor: other });
      // Kunci yang tidak punya sesi, dengan tanda tangan yang tidak bisa dibuat penyerang.
      const c = await hook('message', inbound('X1', 'hai'), { key: other, secretFor: sessionName });
      const d = await (
        await import('supertest')
      )
        .default(app.getHttpServer())
        .post('/api/webhooks/waha/main')
        .send({});
      for (const r of [a, b, c, d]) expect(r.status).toBe(401);
      expect(new Set([a, b, c, d].map((r) => r.body.message)).size).toBe(1);
      expect(await prisma.whatsappMessage.count()).toBe(0);
    });

    it('tanda tangan sah untuk sesi tanpa pemilik dijawab 200 agar WAHA berhenti mengulang', async () => {
      const gone = ghostName(3);
      const r = await hook('message', inbound('X2', 'hai'), { key: gone });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'ignored', reason: 'session_unavailable' });
      expect(await prisma.whatsappMessage.count()).toBe(0);
    });

    it('menyimpan pesan masuk ke pemilik nomor, menghitung belum dibaca, dan idempoten', async () => {
      const first = await hook('message', inbound('A1', 'Halo, mau tanya'));
      expect(first.body).toMatchObject({ ok: true, status: 'created' });
      const again = await hook('message.any', inbound('A1', 'Halo, mau tanya'));
      expect(again.body.status).toBe('duplicate');
      const chat = await prisma.whatsappChat.findFirstOrThrow();
      expect(chat).toMatchObject({
        ownerId: operatorId,
        chatId: CUSTOMER,
        contactName: 'Budi',
        contactPhone: '6281234567890',
        unreadCount: 1,
        lastMessagePreview: 'Halo, mau tanya',
      });
      expect(await prisma.whatsappMessage.count()).toBe(1);
    });

    it('mengabaikan grup, status, event lain, dan pesan tanpa isi; media jadi penanda lampiran', async () => {
      const g = await hook('message', inbound('G1', 'halo', { from: '120363@g.us' }));
      expect(g.body).toMatchObject({ status: 'ignored', reason: 'chat_not_supported' });
      const s = await hook('message', inbound('S1', 'halo', { from: 'status@broadcast' }));
      expect(s.body.reason).toBe('chat_not_supported');
      const e = await hook('presence.update', {});
      expect(e.body).toMatchObject({ status: 'ignored', reason: 'event_not_supported' });
      const n = await hook('message', inbound('N1', '   '));
      expect(n.body.reason).toBe('no_text');
      const m = await hook(
        'message',
        inbound('M1', '', { hasMedia: true, media: { mimetype: 'image/jpeg' } }),
      );
      expect(m.body.status).toBe('created');
      expect((await prisma.whatsappMessage.findFirstOrThrow()).body).toBe('[Lampiran: image/jpeg]');
      const bad = await hook('message', { id: 'x' });
      expect(bad.status).toBe(422);
    });

    it('pesan yang diketik di ponsel (fromMe) menjadi pesan keluar tanpa menambah belum dibaca', async () => {
      await hook('message', {
        id: `true_${CUSTOMER}_PH1`,
        timestamp: Math.floor(Date.now() / 1000),
        from: '628111222333@c.us',
        to: CUSTOMER,
        fromMe: true,
        body: 'Dibalas dari ponsel',
        ack: 2,
      });
      const msg = await prisma.whatsappMessage.findFirstOrThrow();
      expect(msg).toMatchObject({ direction: 'OUTBOUND', status: 'DELIVERED', externalId: 'PH1' });
      expect((await prisma.whatsappChat.findFirstOrThrow()).unreadCount).toBe(0);
    });

    it('status pengiriman hanya maju lewat message.ack', async () => {
      const chat = await firstChat();
      const sent = await post(operator, `/chats/${chat.id}/send`, {
        text: 'Halo Budi',
        clientMessageId: 'client-0001',
      }).expect(200);
      const ext = (
        await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: sent.body.message.id } })
      ).externalId!;
      await hook('message.ack', { id: `true_${CUSTOMER}_${ext}`, ack: 3 });
      expect(
        (await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: sent.body.message.id } }))
          .status,
      ).toBe('READ');
      await hook('message.ack', { id: `true_${CUSTOMER}_${ext}`, ack: 1 });
      expect(
        (await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: sent.body.message.id } }))
          .status,
      ).toBe('READ');
      expect((await hook('message.ack', { id: 'true_x@c.us_TIDAKADA', ack: 3 })).body.reason).toBe(
        'message_unknown',
      );
    });

    it('session.status mencatat putus tak disengaja, dan hilang saat tersambung lagi', async () => {
      await hook('session.status', { status: 'WORKING' });
      expect(
        (await operator.agent.get('/api/whatsapp/sessions/health').expect(200)).body.connectionLost,
      ).toBe(false);
      await hook('session.status', { status: 'STOPPED' });
      const lost = await operator.agent.get('/api/whatsapp/sessions/health').expect(200);
      expect(lost.body).toMatchObject({
        linked: true,
        connectionLost: true,
        lostLabels: ['Nomor 1'],
      });
      await hook('session.status', { status: 'WORKING' });
      expect(
        (await operator.agent.get('/api/whatsapp/sessions/health').expect(200)).body.connectionLost,
      ).toBe(false);
    });
  });

  describe('chat & kepemilikan data', () => {
    it('hanya pemilik dan Super Admin yang melihat chat', async () => {
      const chat = await firstChat();
      const list = await operator.agent.get('/api/whatsapp/chats').expect(200);
      expect(list.body).toMatchObject({ total: 1, unreadTotal: 1 });
      expect(list.body.items[0]).toMatchObject({ id: chat.id, mine: true, unreadCount: 1 });

      const admin = await loginAs(app, 'ADMIN');
      expect((await admin.agent.get('/api/whatsapp/chats').expect(200)).body.total).toBe(0);
      await admin.agent.get(`/api/whatsapp/chats/${chat.id}`).expect(404);
      await post(admin, `/chats/${chat.id}/read`).expect(404);
      await post(admin, `/chats/${chat.id}/send`, {
        text: 'x',
        clientMessageId: 'client-9999',
      }).expect(404);

      const root = await loginAs(app, 'SUPER_ADMIN');
      const all = await root.agent.get('/api/whatsapp/chats').expect(200);
      expect(all.body.items[0]).toMatchObject({
        id: chat.id,
        mine: false,
        owner: { id: operatorId },
      });
      const thread = await root.agent.get(`/api/whatsapp/chats/${chat.id}`).expect(200);
      expect(thread.body.canReply).toBe(false);
      await post(root, `/chats/${chat.id}/send`, {
        text: 'x',
        clientMessageId: 'client-9999',
      }).expect(403);
      expect(waha.sent).toHaveLength(0);
    });

    it('membuka chat lalu menandai terbaca; pencarian dan filter belum dibaca', async () => {
      const chat = await firstChat();
      await post(operator, `/chats/${chat.id}/read`).expect(200);
      expect(
        (await operator.agent.get('/api/whatsapp/chats?unreadOnly=true').expect(200)).body.total,
      ).toBe(0);
      expect(
        (await operator.agent.get('/api/whatsapp/chats?search=budi').expect(200)).body.total,
      ).toBe(1);
      expect(
        (await operator.agent.get('/api/whatsapp/chats?search=62812').expect(200)).body.total,
      ).toBe(1);
      expect(
        (await operator.agent.get('/api/whatsapp/chats?search=zzz').expect(200)).body.total,
      ).toBe(0);
    });
  });

  describe('kirim balasan', () => {
    const send = (chatId: string, text: string, clientMessageId = 'client-0001') =>
      post(operator, `/chats/${chatId}/send`, { text, clientMessageId });

    it('mengirim lewat WAHA, menyimpan, dan menandai terbaca', async () => {
      const chat = await firstChat();
      const res = await send(chat.id, 'Halo Budi, ini info produknya').expect(200);
      expect(res.body).toMatchObject({
        status: 'sent',
        message: { direction: 'OUTBOUND', status: 'SENT' },
      });
      expect(waha.sent).toEqual([
        { session: sessionName, chatId: CUSTOMER, text: 'Halo Budi, ini info produknya' },
      ]);
      const refreshed = await prisma.whatsappChat.findUniqueOrThrow({ where: { id: chat.id } });
      expect(refreshed).toMatchObject({
        unreadCount: 0,
        lastMessagePreview: 'Halo Budi, ini info produknya',
      });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'whatsapp.send' } });
      expect(JSON.stringify(audit.metadata)).not.toContain('info produknya');
    });

    it('ID yang sama tidak mengirim dua kali, dan tidak boleh dipakai untuk pesan lain', async () => {
      const chat = await firstChat();
      await send(chat.id, 'Satu').expect(200);
      const dup = await send(chat.id, 'Satu').expect(200);
      expect(dup.body.status).toBe('duplicate');
      await send(chat.id, 'Dua').expect(409);
      expect(waha.sent).toHaveLength(1);
    });

    it('gagal di WAHA menyisakan pesan gagal, dan dicoba ulang dengan ID yang sama', async () => {
      const chat = await firstChat();
      waha.failNextSend = 'http_500';
      const fail = await send(chat.id, 'Coba kirim').expect(502);
      expect(fail.body.message).toContain('http_500');
      expect(fail.body.message).not.toContain('Coba kirim');
      expect(
        await prisma.whatsappMessage.findFirstOrThrow({ where: { direction: 'OUTBOUND' } }),
      ).toMatchObject({
        status: 'FAILED',
        failureReason: 'http_500',
      });
      const retry = await send(chat.id, 'Coba kirim').expect(200);
      expect(retry.body.status).toBe('sent');
      expect(await prisma.whatsappMessage.count({ where: { direction: 'OUTBOUND' } })).toBe(1);
    });

    it('gema webhook yang tiba lebih dulu diadopsi, bukan menggandakan pesan', async () => {
      const chat = await firstChat();
      // Gema pesan kita tiba sebelum penyimpanan selesai: simulasikan dengan baris gema yang sudah ada.
      await prisma.whatsappMessage.create({
        data: {
          chatId: chat.id,
          externalId: '3EB0FAKE1',
          direction: 'OUTBOUND',
          status: 'DELIVERED',
          body: 'Halo',
          sentAt: new Date(),
        },
      });
      const res = await send(chat.id, 'Halo').expect(200);
      expect(res.body.message.status).toBe('DELIVERED');
      expect(await prisma.whatsappMessage.count({ where: { direction: 'OUTBOUND' } })).toBe(1);
    });

    it('menolak membalas pelanggan yang meminta berhenti sampai ia menulis hal lain', async () => {
      const chat = await firstChat();
      await hook(
        'message',
        inbound('A2', 'STOP.', { timestamp: Math.floor(Date.now() / 1000) + 1 }),
      );
      const blocked = await send(chat.id, 'Baik').expect(409);
      expect(blocked.body.message).toMatch(/berhenti/);
      const thread = await operator.agent.get(`/api/whatsapp/chats/${chat.id}`).expect(200);
      expect(thread.body.canReply).toBe(false);
      await hook(
        'message',
        inbound('A3', 'eh jangan dulu, saya mau lanjut', {
          timestamp: Math.floor(Date.now() / 1000) + 2,
        }),
      );
      await send(chat.id, 'Baik, siap').expect(200);
      expect(waha.sent).toHaveLength(1);
    });

    it('menghormati daftar larangan kontak untuk nomor yang sama', async () => {
      const chat = await firstChat();
      await prisma.doNotContactEntry.create({
        data: { channel: 'PHONE', valueNormalized: '6281234567890' },
      });
      const blocked = await send(chat.id, 'Halo').expect(409);
      expect(blocked.body.message).toMatch(/larangan kontak/);
      expect(waha.sent).toHaveLength(0);
    });

    it('menolak kirim bila nomor belum tersambung, tanpa memanggil sendText atau menyimpan pesan', async () => {
      const chat = await firstChat();
      waha.sessions.set(sessionName, {
        ...waha.sessions.get(sessionName)!,
        status: 'SCAN_QR_CODE',
        meId: null,
      });
      const res = await send(chat.id, 'Halo').expect(409);
      expect(res.body.message).toMatch(/belum tersambung/);
      expect(waha.sent).toHaveLength(0);
      expect(await prisma.whatsappMessage.count({ where: { direction: 'OUTBOUND' } })).toBe(0);
    });

    it('timeout WAHA menyisakan pesan gagal dengan peringatan periksa ponsel', async () => {
      const chat = await firstChat();
      waha.failNextSend = 'timeout';
      const res = await send(chat.id, 'Halo').expect(502);
      expect(res.body.message).toMatch(/periksa ponsel/);
      expect(
        (await prisma.whatsappMessage.findFirstOrThrow({ where: { direction: 'OUTBOUND' } }))
          .failureReason,
      ).toBe('timeout');
    });

    it('memvalidasi body kirim', async () => {
      const chat = await firstChat();
      await send(chat.id, '   ').expect(400);
      await send(chat.id, 'ok', 'a b').expect(400);
    });
  });
  describe('memulai chat duluan', () => {
    const start = (sid: string, phone: string, name?: string, who: Session = operator) =>
      post(who, `/sessions/${sid}/chats`, { phone, name });

    it('membuat chat dari nomor yang diketik (dinormalisasi), lalu pesan pertama dikirim lewat alur biasa', async () => {
      const n = await linkOperator('CS 1');
      const res = await start(n.id, '0812-3456-7890', 'Budi').expect(200);
      expect(res.body).toMatchObject({
        contactName: 'Budi',
        contactPhone: '6281234567890',
        mine: true,
        unreadCount: 0,
        session: { id: n.id, label: 'CS 1' },
      });
      const row = await prisma.whatsappChat.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({
        chatId: '6281234567890@c.us',
        ownerId: operatorId,
        initiatedById: operatorId,
      });
      expect(row.initiatedAt).not.toBeNull();

      const thread = await operator.agent.get(`/api/whatsapp/chats/${row.id}`).expect(200);
      expect(thread.body).toMatchObject({ canReply: true, messages: [] });
      await post(operator, `/chats/${row.id}/send`, {
        text: 'Halo Budi, apa kabar?',
        clientMessageId: 'client-first-01',
      }).expect(200);
      expect(waha.sent).toEqual([
        { session: n.name, chatId: '6281234567890@c.us', text: 'Halo Budi, apa kabar?' },
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'whatsapp.chat.start' },
      });
      expect(JSON.stringify(audit)).not.toContain('6281234567890');
    });

    it('nomor yang sama dengan format berbeda mengembalikan chat yang sama', async () => {
      const n = await linkOperator();
      const a = await start(n.id, '0812-3456-7890').expect(200);
      const b = await start(n.id, '+62 812 3456 7890').expect(200);
      const c = await start(n.id, '6281234567890').expect(200);
      expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(1);
      expect(await prisma.whatsappChat.count()).toBe(1);
    });

    it('memakai chat yang sudah ada dari pesan masuk, termasuk chat @lid dengan nomor yang sama', async () => {
      const n = await linkOperator();
      await hook(
        'message',
        inbound('L1', 'halo dari lid', {
          from: '123456789012345@lid',
          _data: { pushName: 'Budi', key: { remoteJidAlt: CUSTOMER } },
        }),
      );
      const lid = await prisma.whatsappChat.findFirstOrThrow();
      expect(lid.chatId).toBe('123456789012345@lid');
      const res = await start(n.id, '081234567890').expect(200);
      expect(res.body.id).toBe(lid.id);
      expect(await prisma.whatsappChat.count()).toBe(1);
    });

    it('menolak nomor yang tidak terdaftar di WhatsApp, tanpa membuat chat', async () => {
      const n = await linkOperator();
      waha.unregistered.add('6281999000111');
      const res = await start(n.id, '081999000111').expect(422);
      expect(res.body.message).toMatch(/tidak terdaftar/);
      expect(await prisma.whatsappChat.count()).toBe(0);
    });

    it('menolak nomor sendiri, nomor di daftar larangan kontak, dan input tidak valid', async () => {
      const n = await linkOperator();
      expect((await start(n.id, '0811 1222 333').expect(409)).body.message).toMatch(/sendiri/);
      await prisma.doNotContactEntry.create({
        data: { channel: 'PHONE', valueNormalized: '6281234567890' },
      });
      expect((await start(n.id, '081234567890').expect(409)).body.message).toMatch(
        /larangan kontak/,
      );
      await start(n.id, '123').expect(400);
      await start(n.id, 'abc12345678').expect(400);
      await post(operator, `/sessions/${n.id}/chats`, {}).expect(400);
      expect(await prisma.whatsappChat.count()).toBe(0);
    });

    it('menolak bila nomor belum tersambung atau milik user lain', async () => {
      const pending = await addNumber('Belum tersambung');
      expect((await start(pending.id, '081234567890').expect(409)).body.message).toMatch(
        /belum tersambung/,
      );
      const connected = await linkOperator('Tersambung');
      const admin = await loginAs(app, 'ADMIN');
      await start(connected.id, '081234567890', undefined, admin).expect(404);
      const root = await loginAs(app, 'SUPER_ADMIN');
      await start(connected.id, '081234567890', undefined, root).expect(404);
      expect(await prisma.whatsappChat.count()).toBe(0);
    });

    describe('batas chat baru per hari', () => {
      beforeEach(() => {
        process.env.WAHA_NEW_CHATS_PER_DAY = '2';
        resetEnvCache();
      });
      afterEach(() => {
        process.env.WAHA_NEW_CHATS_PER_DAY = '20';
        resetEnvCache();
      });

      it('dihitung per nomor; chat yang sudah ada tidak memakai jatah', async () => {
        const a = await linkOperator('CS 1');
        const b = await linkOperator('CS 2');
        await start(a.id, '081111111111').expect(200);
        await start(a.id, '082222222222').expect(200);
        const over = await start(a.id, '083333333333').expect(429);
        expect(over.body.message).toMatch(/Batas chat baru/);
        // Chat yang sudah ada tetap bisa dibuka, dan nomor lain punya jatah sendiri.
        await start(a.id, '081111111111').expect(200);
        await start(b.id, '083333333333').expect(200);
        expect(await prisma.whatsappChat.count()).toBe(3);
      });
    });

    it('daftar kontak ponsel: difilter di server, dan available=false bila sinkronisasi mati', async () => {
      const n = await linkOperator();
      waha.contacts = [
        { phone: '6281111111111', name: 'Budi Santoso' },
        { phone: '6282222222222', name: 'Siti Aminah' },
      ];
      const get = (sid: string, qs = '', who: Session = operator) =>
        who.agent.get(`/api/whatsapp/sessions/${sid}/contacts${qs}`);
      expect((await get(n.id).expect(200)).body).toEqual({
        available: true,
        items: waha.contacts.map((c) => ({ ...c, saved: true })),
      });
      expect((await get(n.id, '?search=budi').expect(200)).body.items).toEqual([
        { ...waha.contacts[0], saved: true },
      ]);
      expect((await get(n.id, '?search=6282').expect(200)).body.items).toEqual([
        { ...waha.contacts[1], saved: true },
      ]);
      expect((await get(n.id, '?search=zzz').expect(200)).body.items).toEqual([]);

      // Hanya yang tersimpan di buku kontak (bukan sekadar nama profil), bila diminta.
      waha.contacts = [
        { phone: '6281111111111', name: 'Budi Santoso', saved: true },
        { phone: '6283333333333', name: 'Profil Saja', saved: false },
      ];
      const all = (await get(n.id).expect(200)).body.items;
      expect(all.map((c: { name: string; saved: boolean }) => [c.name, c.saved])).toEqual([
        ['Budi Santoso', true],
        ['Profil Saja', false],
      ]);
      const saved = (await get(n.id, '?savedOnly=true').expect(200)).body.items;
      expect(saved.map((c: { name: string }) => c.name)).toEqual(['Budi Santoso']);
      expect((await get(n.id, '?savedOnly=true&search=profil').expect(200)).body.items).toEqual([]);

      waha.contactsAvailable = false;
      expect((await get(n.id).expect(200)).body).toEqual({ available: false, items: [] });

      const admin = await loginAs(app, 'ADMIN');
      await get(n.id, '', admin).expect(404);
      const pending = await addNumber('Belum tersambung');
      await get(pending.id).expect(409);
    });

    it('chat yang dimulai tetapi tidak pernah dikirimi pesan dibersihkan worker setelah sehari', async () => {
      const n = await linkOperator();
      const empty = await start(n.id, '081111111111').expect(200);
      const used = await start(n.id, '082222222222').expect(200);
      const fresh = await start(n.id, '083333333333').expect(200);
      const old = new Date(Date.now() - 48 * 3600 * 1000);
      await prisma.whatsappChat.updateMany({
        where: { id: { in: [empty.body.id, used.body.id] } },
        data: { initiatedAt: old },
      });
      await prisma.whatsappMessage.create({
        data: {
          chatId: used.body.id,
          direction: 'OUTBOUND',
          status: 'SENT',
          body: 'sudah dikirimi',
          sentAt: old,
        },
      });
      const result = await app.get(WhatsappMonitorService).run();
      expect(result.abandoned).toBe(1);
      const left = (await prisma.whatsappChat.findMany({ select: { id: true } })).map((c) => c.id);
      expect(left.sort()).toEqual([used.body.id, fresh.body.id].sort());
    });
  });

  describe('riwayat chat dari ponsel', () => {
    const SITI = '6285711112222@c.us';
    const now = () => Math.floor(Date.now() / 1000);
    const DAY = 86_400;
    /** Pesan seperti yang dikembalikan WAHA dari store (bentuknya sama dengan webhook). */
    const hmsg = (
      jid: string,
      id: string,
      text: string,
      ago: number,
      fromMe = false,
      push: string | null = 'Budi',
    ) => ({
      id: `${fromMe}_${jid}_${id}`,
      timestamp: now() - ago,
      from: fromMe ? '628111222333@c.us' : jid,
      // Store WAHA asli tidak menyertakan `to`; chat tujuan diketahui dari daftar chat.
      fromMe,
      body: text,
      hasMedia: false,
      ack: fromMe ? 3 : null,
      _data: fromMe || !push ? {} : { pushName: push },
    });
    const seed = () => {
      waha.chats = [
        { id: CUSTOMER, name: 'Budi Santoso', lastTimestamp: now() - 2900 },
        { id: SITI, name: null, lastTimestamp: now() - 3 * DAY },
        { id: '120363@g.us', name: 'Grup Keluarga', lastTimestamp: now() },
        { id: '6289900001111@c.us', name: 'Lama', lastTimestamp: now() - 90 * DAY },
      ];
      waha.history = {
        [CUSTOMER]: [
          hmsg(CUSTOMER, 'H3', 'Bisa kak, tersedia untuk iOS dan Android', 2900, true),
          hmsg(CUSTOMER, 'H2', 'Apakah bisa dipakai di iPhone?', 3000),
          hmsg(CUSTOMER, 'H1', 'Halo kak, mau tanya soal Solid Mini', 3500),
          hmsg(CUSTOMER, 'H0', 'pesan sangat lama', 40 * DAY),
        ],
        // Store WAHA asli tidak membawa pushName pada pesan riwayat.
        [SITI]: [hmsg(SITI, 'S1', 'Terima kasih infonya', 3 * DAY, false, null)],
        '6289900001111@c.us': [hmsg('6289900001111@c.us', 'L1', 'di luar jendela', 90 * DAY)],
      };
    };
    const history = () => app.get(WhatsappHistoryService);
    const sessionRow = (id: string) => prisma.wahaSession.findUniqueOrThrow({ where: { id } });

    it('mengimpor chat 1:1 dalam jendela hari tanpa belum dibaca, dan idempoten', async () => {
      const n = await linkOperator('CS 1');
      seed();
      const res = await history().sync(n.id);
      expect(res).toMatchObject({ chats: 2, imported: 4, error: null });

      expect(await prisma.whatsappChat.count()).toBe(2);
      const budi = await prisma.whatsappChat.findFirstOrThrow({ where: { chatId: CUSTOMER } });
      expect(budi).toMatchObject({
        ownerId: operatorId,
        sessionId: n.id,
        contactName: 'Budi Santoso',
        contactPhone: '6281234567890',
        unreadCount: 0,
        initiatedAt: null,
        lastMessagePreview: 'Bisa kak, tersedia untuk iOS dan Android',
      });
      const msgs = await prisma.whatsappMessage.findMany({
        where: { chatId: budi.id },
        orderBy: { sentAt: 'asc' },
      });
      expect(msgs.map((m) => [m.direction, m.status, m.externalId])).toEqual([
        ['INBOUND', 'RECEIVED', 'H1'],
        ['INBOUND', 'RECEIVED', 'H2'],
        ['OUTBOUND', 'READ', 'H3'],
      ]);
      // Grup dan chat di luar jendela tidak diimpor.
      expect(
        await prisma.whatsappChat.count({
          where: { chatId: { in: ['120363@g.us', '6289900001111@c.us'] } },
        }),
      ).toBe(0);

      const again = await history().sync(n.id);
      expect(again).toMatchObject({ chats: 2, imported: 0 });
      expect(await prisma.whatsappMessage.count()).toBe(4);

      const row = await sessionRow(n.id);
      expect(row).toMatchObject({ historyChats: 2, historySyncRuns: 2, historySyncError: null });
      expect(row.historySyncedAt).not.toBeNull();
      expect(row.historySyncStartedAt).toBeNull();
      const list = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(list.body[0]).toMatchObject({
        historyChats: 2,
        historySyncing: false,
        historyError: null,
      });
    });

    it('nama diambil dari kontak ponsel bila daftar chat tidak punya nama; nama tersimpan menang atas nama profil', async () => {
      const n = await linkOperator();
      seed();
      waha.chats = waha.chats.map((c) => ({ ...c, name: null }));
      waha.contacts = [
        { phone: '6281234567890', name: 'Budi Kontak', lid: null },
        { phone: '6285711112222', name: 'Siti Kontak', lid: null },
      ];
      await history().sync(n.id);
      const names = Object.fromEntries(
        (await prisma.whatsappChat.findMany()).map((c) => [c.chatId, c.contactName]),
      );
      // Pesan masuk membawa pushName "Budi", tetapi nama tersimpan di kontak lebih diprioritaskan.
      expect(names).toEqual({ [CUSTOMER]: 'Budi Kontak', [SITI]: 'Siti Kontak' });
    });

    it('chat tanpa nama diisi pada sinkron berikutnya, tanpa menimpa nama yang sudah ada', async () => {
      const n = await linkOperator();
      seed();
      waha.chats = waha.chats.map((c) => ({ ...c, name: null }));
      await history().sync(n.id);
      expect(
        (await prisma.whatsappChat.findFirstOrThrow({ where: { chatId: SITI } })).contactName,
      ).toBeNull();
      waha.contacts = [
        { phone: '6285711112222', name: 'Siti Baru', lid: null },
        { phone: '6281234567890', name: 'Nama Dari Kontak', lid: null },
      ];
      await prisma.whatsappChat.updateMany({
        where: { chatId: CUSTOMER },
        data: { contactName: 'Nama Manual' },
      });
      await history().sync(n.id);
      const names = Object.fromEntries(
        (await prisma.whatsappChat.findMany()).map((c) => [c.chatId, c.contactName]),
      );
      expect(names).toEqual({ [CUSTOMER]: 'Nama Manual', [SITI]: 'Siti Baru' });
    });

    it('tetap berjalan tanpa nama bila kontak tidak tersedia', async () => {
      const n = await linkOperator();
      seed();
      waha.chats = waha.chats.map((c) => ({ ...c, name: null }));
      waha.contactsAvailable = false;
      const res = await history().sync(n.id);
      expect(res).toMatchObject({ chats: 2, error: null });
      // Satu-satunya nama yang tersisa adalah pushName dari pesan masuk.
      expect(
        (await prisma.whatsappChat.findFirstOrThrow({ where: { chatId: SITI } })).contactName,
      ).toBeNull();
    });

    it('konteks terbawa: balasan memakai riwayat, dan pesan berikutnya dari webhook tidak dobel', async () => {
      const n = await linkOperator();
      seed();
      await history().sync(n.id);
      // Pesan yang sama datang lagi lewat webhook (mis. event tertunda): dikenali sebagai duplikat.
      const dup = await hook('message', {
        ...inbound('H2', 'Apakah bisa dipakai di iPhone?'),
        id: `false_${CUSTOMER}_H2`,
      });
      expect(dup.body.status).toBe('duplicate');
      const fresh = await hook('message', inbound('N1', 'Oke kak, saya tertarik'));
      expect(fresh.body.status).toBe('created');
      const chat = await prisma.whatsappChat.findFirstOrThrow({ where: { chatId: CUSTOMER } });
      expect(chat.unreadCount).toBe(1);
      const thread = await operator.agent.get(`/api/whatsapp/chats/${chat.id}`).expect(200);
      expect(thread.body.messages.map((m: { body: string }) => m.body)).toEqual([
        'Halo kak, mau tanya soal Solid Mini',
        'Apakah bisa dipakai di iPhone?',
        'Bisa kak, tersedia untuk iOS dan Android',
        'Oke kak, saya tertarik',
      ]);
    });

    it('tidak menimpa chat yang sudah lebih baru dan nama yang sudah ada', async () => {
      const n = await linkOperator();
      await hook('message', inbound('N1', 'pesan terbaru dari webhook'));
      await prisma.whatsappChat.updateMany({ data: { contactName: 'Nama Manual' } });
      seed();
      await history().sync(n.id);
      const chat = await prisma.whatsappChat.findFirstOrThrow({ where: { chatId: CUSTOMER } });
      expect(chat).toMatchObject({
        contactName: 'Nama Manual',
        lastMessagePreview: 'pesan terbaru dari webhook',
        unreadCount: 1,
      });
    });

    it('mencatat kode kesalahan bila store WAHA mati (nomor perlu dipindai ulang)', async () => {
      const n = await linkOperator();
      waha.storeEnabled = false;
      const res = await history().sync(n.id);
      expect(res).toMatchObject({ chats: 0, imported: 0, error: 'store_disabled' });
      expect(await prisma.whatsappChat.count()).toBe(0);
      const list = await operator.agent.get('/api/whatsapp/sessions').expect(200);
      expect(list.body[0]).toMatchObject({ historyError: 'store_disabled' });
      // Berhasil di putaran berikutnya menghapus kodenya.
      waha.storeEnabled = true;
      seed();
      await history().sync(n.id);
      expect((await sessionRow(n.id)).historySyncError).toBeNull();
    });

    it('dua proses tidak menyinkronkan nomor yang sama bersamaan (lease)', async () => {
      const n = await linkOperator();
      seed();
      const [a, b] = await Promise.all([history().sync(n.id), history().sync(n.id)]);
      expect([a, b].filter((r) => r === null)).toHaveLength(1);
      expect(waha.listChatsCalls).toBe(1);
      // Lease basi (proses mati) diambil alih.
      await prisma.wahaSession.update({
        where: { id: n.id },
        data: { historySyncStartedAt: new Date(Date.now() - 20 * 60_000) },
      });
      expect(await history().sync(n.id)).not.toBeNull();
    });

    it('penjadwal: hanya nomor tersambung yang perlu, dengan putaran awal berdekatan lalu penyusul berkala', async () => {
      const n = await linkOperator();
      seed();
      // Belum ada status WORKING tercatat: tidak disinkronkan.
      expect(await history().runDue()).toEqual({ synced: 0 });
      await hook('session.status', { status: 'WORKING' });
      expect(await history().runDue()).toEqual({ synced: 1 });
      // Segera setelahnya tidak jatuh tempo.
      expect(await history().runDue()).toEqual({ synced: 0 });
      expect(waha.listChatsCalls).toBe(1);

      const ago = (min: number) => new Date(Date.now() - min * 60_000);
      await prisma.wahaSession.update({ where: { id: n.id }, data: { historySyncedAt: ago(11) } });
      expect(await history().runDue()).toEqual({ synced: 1 }); // putaran awal ke-2
      await prisma.wahaSession.update({
        where: { id: n.id },
        data: { historySyncedAt: ago(11), historySyncRuns: 4 },
      });
      expect(await history().runDue()).toEqual({ synced: 0 }); // putaran awal habis
      await prisma.wahaSession.update({
        where: { id: n.id },
        data: { historySyncedAt: ago(7 * 60) },
      });
      expect(await history().runDue()).toEqual({ synced: 1 }); // penyusul berkala
    });

    it('menautkan pasangan baru (menunggu QR) mengulang sinkronisasi dari awal', async () => {
      const n = await linkOperator();
      seed();
      await hook('session.status', { status: 'WORKING' });
      await history().sync(n.id);
      expect((await sessionRow(n.id)).historySyncedAt).not.toBeNull();
      await hook('session.status', { status: 'SCAN_QR_CODE' });
      expect(await sessionRow(n.id)).toMatchObject({
        historySyncedAt: null,
        historySyncRuns: 0,
        historyChats: 0,
      });
    });

    it('sinkron manual: hanya pemilik, hanya nomor tersambung, berjalan di latar belakang', async () => {
      const n = await linkOperator('CS 1');
      seed();
      const call = (who: Session, id: string) => post(who, `/sessions/${id}/sync-history`);
      await call(operator, n.id).expect(409); // belum tercatat tersambung
      await hook('session.status', { status: 'WORKING' });
      const admin = await loginAs(app, 'ADMIN');
      await call(admin, n.id).expect(404);
      const res = await call(operator, n.id).expect(200);
      expect(res.body).toEqual({ started: true });
      for (let i = 0; i < 40 && !(await sessionRow(n.id)).historySyncedAt; i++)
        await new Promise((r) => setTimeout(r, 50));
      expect(await prisma.whatsappChat.count()).toBe(2);
      // Lease dipegang proses lain: tidak memulai yang kedua.
      await prisma.wahaSession.update({
        where: { id: n.id },
        data: { historySyncStartedAt: new Date() },
      });
      expect((await call(operator, n.id).expect(200)).body).toEqual({ started: false });
    });

    it('nomor baru dibuat dengan store aktif agar riwayat tersedia; dimatikan lewat env', async () => {
      await addNumber('CS 1');
      expect(waha.created[0].config.noweb).toEqual({ store: { enabled: true, fullSync: true } });

      process.env.WAHA_HISTORY_SYNC = 'false';
      resetEnvCache();
      try {
        const n = await linkOperator('CS 2');
        expect(waha.created[1].config.noweb).toBeUndefined();
        await post(operator, `/sessions/${n.id}/sync-history`).expect(503);
        expect(await history().runDue()).toEqual({ synced: 0 });
      } finally {
        process.env.WAHA_HISTORY_SYNC = 'true';
        resetEnvCache();
      }
    });
  });

  describe('kirim terjadwal ke daftar terpilih', () => {
    const svc = () => app.get(WhatsappBroadcastService);
    const PHONES = { budi: '0811-1111-1111', siti: '081222222222' };
    /** Nomor tersambung dan tercatat WORKING (syarat membuat blast). */
    const working = async (label = 'CS 1') => {
      const n = await linkOperator(label);
      await hook('session.status', { status: 'WORKING' }, { key: n.name });
      return n;
    };
    const body = (sessionId: string, over: Record<string, unknown> = {}) => ({
      sessionId,
      name: 'Info promo',
      message: 'Halo {{nama}}, ada info baru',
      recipients: [{ phone: PHONES.budi, name: 'Budi' }, { phone: PHONES.siti }],
      consent: true,
      ...over,
    });
    const create = (b: object, who: Session = operator) => post(who, '/broadcasts', b);
    /** Jam buatan: tiap putaran maju 61 detik, melewati jeda acak maksimal (60 detik). */
    let clock = new Date();
    beforeEach(() => {
      clock = new Date(Date.now() + 10_000);
    });
    const tick = async () => {
      const r = await svc().tick(clock);
      clock = new Date(clock.getTime() + 61_000);
      return r.processed;
    };
    const run = async (max = 12) => {
      for (let i = 0; i < max; i++) await tick();
    };
    const recipients = async (id: string) =>
      (await prisma.whatsappBroadcastRecipient.findMany({ where: { broadcastId: id } })).sort(
        (a, b) => a.phone.localeCompare(b.phone),
      );
    const row = (id: string) => prisma.whatsappBroadcast.findUniqueOrThrow({ where: { id } });

    it('persetujuan wajib, variabel valid, dan nomor dinormalisasi serta didedupe', async () => {
      const n = await working();
      await create(body(n.id, { consent: false })).expect(400);
      await create(body(n.id, { message: 'Halo {{name}}!' })).expect(400);
      await create(body(n.id, { recipients: [] })).expect(400);
      await create(body(n.id, { recipients: [{ phone: 'abc' }] })).expect(400);
      expect(await prisma.whatsappBroadcast.count()).toBe(0);

      const res = await create(
        body(n.id, {
          recipients: [
            { phone: '0811-1111-1111', name: 'Budi' },
            { phone: '+62 811 1111 1111', name: 'Duplikat' },
            { phone: '081222222222' },
          ],
        }),
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'RUNNING',
        total: 2,
        pending: 2,
        sent: 0,
        sessionLabel: 'CS 1',
      });
      expect((await recipients(res.body.id)).map((r) => [r.phone, r.name])).toEqual([
        ['6281111111111', 'Budi'],
        ['6281222222222', null],
      ]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'whatsapp.broadcast.create' },
      });
      expect(audit.metadata).toMatchObject({ recipients: 2, consentConfirmed: true });
      expect(JSON.stringify(audit)).not.toMatch(/6281111111111|ada info baru/);
    });

    it('mengirim bertahap, satu penerima per putaran, dengan personalisasi dan jeda acak', async () => {
      const n = await working();
      const { body: b } = await create(body(n.id)).expect(200);
      // Belum jatuh tempo: tidak ada yang dikirim.
      expect((await svc().tick(new Date())).processed).toBe(0);
      expect(waha.sent).toHaveLength(0);

      expect(await tick()).toBe(1);
      expect(waha.sent).toHaveLength(1);
      const gap = (await row(b.id)).nextSendAt!.getTime() - (clock.getTime() - 61_000);
      expect(gap).toBeGreaterThanOrEqual(20_000);
      expect(gap).toBeLessThanOrEqual(60_000);
      // Putaran yang sama diulang sebelum jatuh tempo tidak mengirim lagi.
      expect((await svc().tick(new Date(clock.getTime() - 61_000))).processed).toBe(0);

      await tick();
      expect(waha.sent.map((m) => m.text).sort()).toEqual([
        'Halo Budi, ada info baru',
        'Halo kak, ada info baru',
      ]);
      expect(waha.sent.every((m) => m.session === n.name)).toBe(true);
      const done = await row(b.id);
      expect(done).toMatchObject({ status: 'DONE', nextSendAt: null });
      expect(done.finishedAt).not.toBeNull();
      expect(await prisma.whatsappChat.count({ where: { initiatedAt: { not: null } } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { action: 'whatsapp.send' } })).toBe(2);
      const detail = await operator.agent.get(`/api/whatsapp/broadcasts/${b.id}`).expect(200);
      expect(detail.body).toMatchObject({ status: 'DONE', total: 2, sent: 2, pending: 0 });
      expect(detail.body.recipients.map((r: { status: string }) => r.status)).toEqual([
        'SENT',
        'SENT',
      ]);
    });

    it('melewati DNC, yang minta berhenti, dan nomor sendiri; gagal bila tidak terdaftar', async () => {
      const n = await working();
      await prisma.doNotContactEntry.create({
        data: { channel: 'PHONE', valueNormalized: '6281000000001' },
      });
      await hook(
        'message',
        inbound('Z1', 'STOP', { from: '6281000000002@c.us', _data: { pushName: 'Rina' } }),
        { key: n.name },
      );
      waha.unregistered.add('6281000000003');
      const { body: b } = await create(
        body(n.id, {
          recipients: [
            { phone: '6281000000001' }, // DNC
            { phone: '6281000000002' }, // minta berhenti
            { phone: '6281000000003' }, // tidak terdaftar
            { phone: '628111222333' }, // nomor sendiri
            { phone: '6281000000005', name: 'Ani' }, // normal
          ],
        }),
      ).expect(200);
      await run();
      const by = Object.fromEntries(
        (await recipients(b.id)).map((r) => [r.phone, [r.status, r.reason]]),
      );
      expect(by).toEqual({
        '6281000000001': ['SKIPPED', 'dnc'],
        '6281000000002': ['SKIPPED', 'opt_out'],
        '6281000000003': ['FAILED', 'not_registered'],
        '628111222333': ['SKIPPED', 'self'],
        '6281000000005': ['SENT', null],
      });
      expect(waha.sent.map((m) => m.text)).toEqual(['Halo Ani, ada info baru']);
      expect(await row(b.id)).toMatchObject({ status: 'DONE', consecutiveFailures: 0 });
    });

    it('kegagalan kirim tercatat dengan kodenya, termasuk timeout yang statusnya tidak pasti', async () => {
      const n = await working();
      const { body: b } = await create(
        body(n.id, {
          recipients: [
            { phone: '6281000000011' },
            { phone: '6281000000012' },
            { phone: '6281000000013' },
          ],
        }),
      ).expect(200);
      waha.failNextSend = 'http_500';
      await tick();
      waha.failNextSend = 'timeout';
      await tick();
      await tick();
      const reasons = (await recipients(b.id)).map((r) => `${r.status}:${r.reason}`).sort();
      expect(reasons).toEqual([
        'FAILED:send_failed:http_500',
        'FAILED:send_failed:timeout',
        'SENT:null',
      ]);
    });

    it('tiga kegagalan berturut-turut menjeda otomatis, dan bisa dilanjutkan', async () => {
      const n = await working();
      const nums = ['6281000000021', '6281000000022', '6281000000023', '6281000000024'];
      nums.forEach((p) => waha.unregistered.add(p));
      const { body: b } = await create(
        body(n.id, { recipients: nums.map((phone) => ({ phone })) }),
      ).expect(200);
      await run(5);
      expect(await row(b.id)).toMatchObject({
        status: 'PAUSED',
        pauseReason: 'too_many_failures',
        consecutiveFailures: 3,
      });
      expect((await recipients(b.id)).filter((r) => r.status === 'PENDING')).toHaveLength(1);
      expect(await tick()).toBe(0);

      await post(operator, `/broadcasts/${b.id}/resume`).expect(200);
      clock = new Date(Date.now() + 10_000);
      await tick();
      expect(await row(b.id)).toMatchObject({ status: 'DONE', pauseReason: null });
    });

    it('nomor terputus menjeda tanpa kehilangan penerima, lalu lanjut setelah tersambung lagi', async () => {
      const n = await working();
      const { body: b } = await create(body(n.id)).expect(200);
      waha.sessions.set(n.name, { ...waha.sessions.get(n.name)!, status: 'STOPPED' });
      await tick();
      expect(await row(b.id)).toMatchObject({
        status: 'PAUSED',
        pauseReason: 'session_not_connected',
      });
      expect(waha.sent).toHaveLength(0);
      expect((await recipients(b.id)).every((r) => r.status === 'PENDING')).toBe(true);

      waha.link(n.name);
      await post(operator, `/broadcasts/${b.id}/resume`).expect(200);
      clock = new Date(Date.now() + 10_000);
      await run(3);
      expect(await row(b.id)).toMatchObject({ status: 'DONE' });
      expect(waha.sent).toHaveLength(2);
    });

    it('tidak mengirim dua kali bila proses mati setelah kirim sebelum mencatat (idempoten)', async () => {
      const n = await working();
      const { body: b } = await create(
        body(n.id, { recipients: [{ phone: '6281000000031' }] }),
      ).expect(200);
      await tick();
      expect(waha.sent).toHaveLength(1);
      // Simulasi crash: pesan terkirim tetapi penerima belum sempat ditandai.
      await prisma.whatsappBroadcastRecipient.updateMany({
        where: { broadcastId: b.id },
        data: { status: 'PENDING', sentAt: null },
      });
      await prisma.whatsappBroadcast.update({
        where: { id: b.id },
        data: { status: 'RUNNING', nextSendAt: new Date(0), finishedAt: null },
      });
      await tick();
      expect(waha.sent).toHaveLength(1);
      expect((await recipients(b.id))[0].status).toBe('SENT');
    });

    it('dua proses tidak mengambil penerima yang sama bersamaan', async () => {
      const n = await working();
      await create(body(n.id)).expect(200);
      const [a, c] = await Promise.all([svc().tick(clock), svc().tick(clock)]);
      expect(a.processed + c.processed).toBe(1);
      expect(waha.sent).toHaveLength(1);
    });

    describe('batas harian per nomor', () => {
      beforeEach(() => {
        process.env.WAHA_BROADCAST_PER_DAY = '2';
        resetEnvCache();
      });
      afterEach(() => {
        process.env.WAHA_BROADCAST_PER_DAY = '30';
        resetEnvCache();
      });

      it('berhenti setelah batas tercapai dan lanjut keesokan harinya', async () => {
        const n = await working();
        const phones = ['6281000000041', '6281000000042', '6281000000043'];
        const { body: b } = await create(
          body(n.id, { recipients: phones.map((phone) => ({ phone })) }),
        ).expect(200);
        await run(3);
        expect(waha.sent).toHaveLength(2);
        const waiting = await row(b.id);
        expect(waiting.status).toBe('RUNNING');
        expect(waiting.nextSendAt!.getTime()).toBeGreaterThan(clock.getTime());
        expect((await recipients(b.id)).filter((r) => r.status === 'PENDING')).toHaveLength(1);

        // Besok (WIB): jatah baru.
        clock = new Date(waiting.nextSendAt!.getTime() + 1000);
        await tick();
        expect(waha.sent).toHaveLength(3);
        expect((await row(b.id)).status).toBe('DONE');
      });
    });

    it('jeda, lanjutkan, dan batalkan; yang belum dikirim dilewati saat dibatalkan', async () => {
      const n = await working();
      const { body: b } = await create(body(n.id)).expect(200);
      await post(operator, `/broadcasts/${b.id}/resume`).expect(409); // belum dijeda
      await post(operator, `/broadcasts/${b.id}/pause`).expect(200);
      expect(await row(b.id)).toMatchObject({
        status: 'PAUSED',
        pauseReason: 'manual',
        nextSendAt: null,
      });
      expect(await tick()).toBe(0);
      await post(operator, `/broadcasts/${b.id}/pause`).expect(409);
      await post(operator, `/broadcasts/${b.id}/resume`).expect(200);
      const res = await post(operator, `/broadcasts/${b.id}/cancel`).expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', skipped: 2, pending: 0 });
      expect((await recipients(b.id)).map((r) => r.reason)).toEqual(['cancelled', 'cancelled']);
      expect(await tick()).toBe(0);
      expect(waha.sent).toHaveLength(0);
      await post(operator, `/broadcasts/${b.id}/cancel`).expect(409);
    });

    it('hanya pemilik; nomor orang lain dan nomor belum tersambung ditolak', async () => {
      const n = await working();
      const { body: b } = await create(body(n.id)).expect(200);
      const admin = await loginAs(app, 'ADMIN');
      const root = await loginAs(app, 'SUPER_ADMIN');
      for (const who of [admin, root]) {
        await create(body(n.id), who).expect(404);
        await who.agent.get(`/api/whatsapp/broadcasts/${b.id}`).expect(404);
        await post(who, `/broadcasts/${b.id}/pause`).expect(404);
        await post(who, `/broadcasts/${b.id}/cancel`).expect(404);
        expect((await who.agent.get('/api/whatsapp/broadcasts').expect(200)).body).toEqual([]);
      }
      expect((await operator.agent.get('/api/whatsapp/broadcasts').expect(200)).body).toHaveLength(
        1,
      );
      const pending = await addNumber('Belum tersambung');
      expect((await create(body(pending.id)).expect(409)).body.message).toMatch(/belum tersambung/);
      const viewer = await loginAs(app, 'VIEWER');
      await create(body(n.id), viewer).expect(403);
    });

    it('batas jumlah penerima dan dimatikan lewat env', async () => {
      const n = await working();
      process.env.WAHA_BROADCAST_MAX_RECIPIENTS = '1';
      resetEnvCache();
      try {
        const res = await create(body(n.id)).expect(400);
        expect(res.body.message).toMatch(/Maksimal 1 penerima/);
      } finally {
        process.env.WAHA_BROADCAST_MAX_RECIPIENTS = '50';
        resetEnvCache();
      }
      const { body: b } = await create(body(n.id)).expect(200);
      process.env.WAHA_BROADCAST_ENABLED = 'false';
      resetEnvCache();
      try {
        await create(body(n.id)).expect(503);
        expect(await tick()).toBe(0);
        expect(waha.sent).toHaveLength(0);
      } finally {
        process.env.WAHA_BROADCAST_ENABLED = 'true';
        resetEnvCache();
      }
      expect((await row(b.id)).status).toBe('RUNNING');
    });
  });

  describe('mode satu sesi (WAHA Core)', () => {
    beforeEach(() => {
      process.env.WAHA_SESSION_NAME = 'default';
      resetEnvCache();
    });
    afterEach(() => {
      delete process.env.WAHA_SESSION_NAME;
      resetEnvCache();
    });

    it('memakai nama sesi tetap, hanya satu nomor di server, dan webhook ke kunci itu', async () => {
      const cfg = await operator.agent.get('/api/whatsapp/config').expect(200);
      expect(cfg.body).toMatchObject({ maxSessionsPerUser: 1, singleSession: true });
      await post(operator, '/sessions', { label: 'Nomor 1' }).expect(200);
      // Pemilik yang sama pun tidak bisa menambah nomor kedua.
      await post(operator, '/sessions', { label: 'Nomor 2' }).expect(409);
      expect((await prisma.wahaSession.findFirstOrThrow()).sessionName).toBe('default');
      expect(waha.created[0].name).toBe('default');

      const admin = await loginAs(app, 'ADMIN');
      const second = await post(admin, '/sessions', { label: 'Nomor X' }).expect(409);
      expect(second.body.message).toMatch(/satu nomor/);

      sessionName = 'default';
      const res = await hook('message', inbound('C1', 'halo dari Core'));
      expect(res.body.status).toBe('created');
      expect((await prisma.whatsappChat.findFirstOrThrow()).ownerId).toBe(operatorId);
      // Kunci per-user tidak dikenali di mode ini bila sesinya tidak ada, dan kunci asing tetap ditolak.
      expect(
        (await hook('message', inbound('C2', 'x'), { key: 'main', secretFor: 'default' })).status,
      ).toBe(401);
    });
  });
});
