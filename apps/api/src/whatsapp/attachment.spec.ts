import { cleanFilename } from './attachment';
import { HttpWahaGateway, WahaError } from './waha-gateway';

describe('cleanFilename', () => {
  it('membuang path, memaksa ekstensi sesuai isi file, dan mengganti karakter aneh', () => {
    expect(cleanFilename('../../etc/passwd.exe', 'image/jpeg')).toBe('passwd.jpg');
    expect(cleanFilename('C:\\Users\\Budi\\Brosur Promo.PDF', 'application/pdf')).toBe(
      'Brosur Promo.pdf',
    );
    expect(cleanFilename('foto<script>.jpeg', 'image/jpeg')).toBe('foto_script_.jpg');
    // Tanpa nama sama sekali, atau hanya titik: nama bawaan.
    expect(cleanFilename('.pdf', 'application/pdf')).toBe('lampiran.pdf');
    expect(cleanFilename('', 'image/jpeg')).toBe('lampiran.jpg');
  });

  it('memulihkan nama UTF-8 yang dibaca sebagai latin1 oleh multer, dan memotong nama panjang', () => {
    const asLatin1 = Buffer.from('Katalog Kopi ☕.pdf', 'utf8').toString('latin1');
    expect(cleanFilename(asLatin1, 'application/pdf')).toBe('Katalog Kopi _.pdf');
    expect(cleanFilename('é.pdf', 'application/pdf')).toBe('é.pdf');
    expect(cleanFilename(`${'a'.repeat(200)}.pdf`, 'application/pdf')).toHaveLength(84);
  });
});

describe('HttpWahaGateway.sendMedia', () => {
  const gw = new HttpWahaGateway('http://waha:3000', 'kunci', 5000);
  const data = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
  let calls: Array<{ url: string; body: Record<string, unknown> }>;
  const reply = (status: number, json: unknown) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(json), { status });
    });
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => jest.restoreAllMocks());

  it('gambar lewat sendImage dan dokumen lewat sendFile, berkas sebagai base64 dengan caption', async () => {
    reply(201, { id: 'true_6281@c.us_ABC' });
    const img = { kind: 'image' as const, mimetype: 'image/jpeg', filename: 'a.jpg', data };
    expect(await gw.sendMedia('u-1', '6281@c.us', img, 'Halo')).toBe('true_6281@c.us_ABC');
    await gw.sendMedia(
      'u-1',
      '6281@c.us',
      { ...img, kind: 'document', mimetype: 'application/pdf', filename: 'a.pdf' },
      'Hai',
    );
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/sendImage', '/api/sendFile']);
    expect(calls[0].body).toEqual({
      session: 'u-1',
      chatId: '6281@c.us',
      caption: 'Halo',
      file: { mimetype: 'image/jpeg', filename: 'a.jpg', data: data.toString('base64') },
    });
  });

  it('galat HTTP dan respons tanpa ID menjadi WahaError dengan kode yang jelas', async () => {
    const img = { kind: 'image' as const, mimetype: 'image/jpeg', filename: 'a.jpg', data };
    reply(422, { message: 'x' });
    await expect(gw.sendMedia('u-1', '6281@c.us', img, 'x')).rejects.toMatchObject({
      code: 'http_422',
    });
    jest.restoreAllMocks();
    reply(201, {});
    await expect(gw.sendMedia('u-1', '6281@c.us', img, 'x')).rejects.toEqual(
      new WahaError('response_without_message_id'),
    );
    await expect(gw.sendMedia('bukan sesi!', '6281@c.us', img, 'x')).rejects.toMatchObject({
      code: 'invalid_session_name',
    });
  });
});
