import { describe, expect, it } from 'vitest';
import {
  broadcastReasonText,
  broadcastTemplateProblems,
  broadcastUsedVars,
  detectAttachmentMime,
  extractRecipients,
  isExplicitOptOut,
  isOptOutMessage,
  maskPhone,
  phoneFromJid,
  shortWhatsappMessageId,
  renderBroadcastMessage,
  unknownBroadcastPlaceholders,
  whatsappBroadcastSchema,
  whatsappChatsQuerySchema,
  whatsappNumberSchema,
  whatsappSendSchema,
  whatsappStartChatSchema,
} from '../src';

describe('whatsapp', () => {
  it('mengenali permintaan berhenti hanya bila seluruh pesan', () => {
    expect(isOptOutMessage('STOP')).toBe(true);
    expect(isOptOutMessage(' Berhenti. ')).toBe(true);
    expect(isOptOutMessage('jangan kirim lagi!!')).toBe(true);
    expect(isOptOutMessage('kapan sebaiknya stop loss?')).toBe(false);
    expect(isOptOutMessage('tolong jangan berhenti kirim info')).toBe(false);
  });

  it('hanya frasa tidak ambigu yang dianggap permintaan berhenti eksplisit', () => {
    expect(isExplicitOptOut('STOP')).toBe(true);
    expect(isExplicitOptOut('Jangan hubungi lagi.')).toBe(true);
    expect(isExplicitOptOut('unsubscribe')).toBe(true);
    // Tetap memblokir balasan, tetapi bukan alasan cukup untuk larangan permanen.
    expect(isOptOutMessage('cukup')).toBe(true);
    expect(isExplicitOptOut('cukup')).toBe(false);
    expect(isExplicitOptOut('hentikan')).toBe(false);
    expect(isExplicitOptOut('tolong jangan stop kirim info')).toBe(false);
  });

  it('mereduksi ID pesan ke bagian terakhir', () => {
    expect(shortWhatsappMessageId('true_6281234567890@c.us_3EB0ABC')).toBe('3EB0ABC');
    expect(shortWhatsappMessageId('3EB0ABC')).toBe('3EB0ABC');
  });

  it('mengambil nomor hanya dari JID @c.us', () => {
    expect(phoneFromJid('6281234567890@c.us')).toBe('6281234567890');
    expect(phoneFromJid('123456789012345@lid')).toBeNull();
    expect(phoneFromJid('120363@g.us')).toBeNull();
  });

  it('menyamarkan nomor', () => {
    expect(maskPhone('6281234567890')).toBe('+62•••••••7890');
    expect(maskPhone('123')).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });

  it('memvalidasi body kirim', () => {
    expect(
      whatsappSendSchema.safeParse({ text: ' halo ', clientMessageId: 'abcd1234' }),
    ).toMatchObject({
      success: true,
      data: { text: 'halo' },
    });
    expect(whatsappSendSchema.safeParse({ text: '  ', clientMessageId: 'abcd1234' }).success).toBe(
      false,
    );
    expect(whatsappSendSchema.safeParse({ text: 'x', clientMessageId: 'a b' }).success).toBe(false);
  });

  it('memvalidasi nama nomor dan filter nomor pada daftar chat', () => {
    expect(whatsappNumberSchema.parse({ label: '  CS 1 ' }).label).toBe('CS 1');
    expect(whatsappNumberSchema.safeParse({ label: '   ' }).success).toBe(false);
    expect(whatsappNumberSchema.safeParse({ label: 'x'.repeat(41) }).success).toBe(false);
    expect(whatsappChatsQuerySchema.safeParse({ sessionId: 'bukan-uuid' }).success).toBe(false);
    expect(
      whatsappChatsQuerySchema.parse({ sessionId: '0f8fad5b-d9cb-469f-a165-70867728950e' })
        .sessionId,
    ).toBeDefined();
  });

  it('memvalidasi nomor untuk memulai chat', () => {
    expect(whatsappStartChatSchema.safeParse({ phone: '0812-3456-7890' }).success).toBe(true);
    expect(
      whatsappStartChatSchema.safeParse({ phone: '+62 812 3456 7890', name: ' Budi ' }),
    ).toMatchObject({
      success: true,
      data: { name: 'Budi' },
    });
    expect(whatsappStartChatSchema.safeParse({ phone: '123' }).success).toBe(false);
    expect(whatsappStartChatSchema.safeParse({ phone: 'abc12345678' }).success).toBe(false);
    expect(whatsappStartChatSchema.safeParse({}).success).toBe(false);
  });

  it('mengganti {{nama}} dan melaporkan variabel yang tidak dikenal', () => {
    expect(renderBroadcastMessage('Halo {{nama}}, apa kabar?', ' Budi ')).toBe(
      'Halo Budi, apa kabar?',
    );
    expect(renderBroadcastMessage('Halo {{ nama }}!', null)).toBe('Halo kak!');
    expect(unknownBroadcastPlaceholders('Hai {{nama}} {{name}} {{ link }}')).toEqual([
      'name',
      'link',
    ]);
  });

  it('memvalidasi blast: persetujuan wajib, variabel valid, penerima 1 sampai 200', () => {
    const ok = {
      sessionId: '0f8fad5b-d9cb-469f-a165-70867728950e',
      name: 'Promo',
      message: 'Halo {{nama}}, ada info baru',
      recipients: [{ phone: '0812-3456-7890', name: 'Budi' }],
      consent: true,
    };
    expect(whatsappBroadcastSchema.safeParse(ok).success).toBe(true);
    expect(whatsappBroadcastSchema.safeParse({ ...ok, consent: false }).success).toBe(false);
    expect(whatsappBroadcastSchema.safeParse({ ...ok, message: 'Halo {{name}}!' }).success).toBe(
      false,
    );
    expect(whatsappBroadcastSchema.safeParse({ ...ok, recipients: [] }).success).toBe(false);
    expect(
      whatsappBroadcastSchema.safeParse({ ...ok, recipients: [{ phone: 'abc' }] }).success,
    ).toBe(false);
  });
});

describe('impor penerima dari file', () => {
  it('membaca kolom lewat header, urutan kolom bebas', () => {
    const r = extractRecipients([
      ['No', 'Nama', 'Nomor WA'],
      ['1', 'Budi', '0812 3456 7890'],
      ['2', 'Siti', '+62 813-1111-2222'],
    ]);
    // kolom "No" (1, 2) adalah nomor urut, bukan telepon
    expect(r).toEqual({
      recipients: [
        { phone: '0812 3456 7890', name: 'Budi', vars: { no: '1' } },
        { phone: '+62 813-1111-2222', name: 'Siti', vars: { no: '2' } },
      ],
      invalid: 0,
      variables: ['no'],
    });
  });

  it('memakai kolom bernama ketika header dikenali', () => {
    const r = extractRecipients([
      ['Email', 'Telepon', 'Name'],
      ['a@x.id', '081234567890', 'Ani'],
      ['b@x.id', 'bukan nomor', 'Bayu'],
    ]);
    expect(r.recipients).toEqual([
      { phone: '081234567890', name: 'Ani', vars: { email: 'a@x.id' } },
    ]);
    expect(r.invalid).toBe(1);
  });

  it('tanpa header: nomor saja atau nama + nomor, baris kosong diabaikan', () => {
    const r = extractRecipients([['Budi', '081234567890'], ['', ''], ['081311112222'], ['abc']]);
    expect(r.recipients).toEqual([
      { phone: '081234567890', name: 'Budi' },
      { phone: '081311112222' },
    ]);
    expect(r.invalid).toBe(1);
  });

  it('memotong nama melewati 100 karakter agar lolos skema', () => {
    const r = extractRecipients([['N'.repeat(150), '081234567890']]);
    expect(r.recipients[0].name).toHaveLength(100);
  });

  it('file kosong tidak menghasilkan apa-apa', () => {
    expect(extractRecipients([])).toEqual({ recipients: [], invalid: 0, variables: [] });
    expect(extractRecipients([['Nama', 'Nomor']])).toEqual({
      recipients: [],
      invalid: 0,
      variables: [],
    });
  });
});

describe('teks alasan penerima', () => {
  it('memetakan alasan dikenal, timeout, dan kode gagal kirim', () => {
    expect(broadcastReasonText(null)).toBe('');
    expect(broadcastReasonText('dnc')).toBe('Ada di daftar larangan kontak');
    expect(broadcastReasonText('send_failed:timeout')).toMatch(/status tidak pasti/);
    expect(broadcastReasonText('send_failed:502')).toBe('Gagal kirim (502)');
  });
});

describe('variabel pesan dari kolom file', () => {
  const rows = [
    ['Nama', 'Nomor', 'Kota', 'Produk Favorit', '2fa', 'Nama'],
    ['Budi', '081234567890', 'Bandung', 'Kopi', 'x', 'dup'],
    ['Siti', '081311112222', '', 'Teh', 'y', ''],
  ];

  it('kolom lain jadi variabel bernama sesuai header; kosong tidak punya variabel itu', () => {
    const r = extractRecipients(rows);
    // "Nama" kedua (duplikat dari kolom nama) dan "2fa" (diawali angka) tidak bisa jadi variabel.
    expect(r.variables).toEqual(['kota', 'produk_favorit']);
    expect(r.recipients).toEqual([
      { phone: '081234567890', name: 'Budi', vars: { kota: 'Bandung', produk_favorit: 'Kopi' } },
      { phone: '081311112222', name: 'Siti', vars: { produk_favorit: 'Teh' } },
    ]);
  });

  it('dibatasi sepuluh kolom variabel dan nilai dipotong 200 karakter', () => {
    const head = ['Nomor', ...Array.from({ length: 14 }, (_, i) => `v${i}`)];
    const r = extractRecipients([head, ['081234567890', 'x'.repeat(300), ...Array(13).fill('y')]]);
    expect(r.variables).toHaveLength(10);
    expect(r.recipients[0].vars!.v0).toHaveLength(200);
  });

  it('tanpa header tidak ada variabel', () => {
    expect(extractRecipients([['Budi', '081234567890', 'Bandung']]).variables).toEqual([]);
  });

  it('merender {{nama}} dan {{kunci}}, placeholder tak dikenal dibiarkan', () => {
    expect(
      renderBroadcastMessage('Halo {{nama}} di {{ kota }}, {{x}}', 'Budi', { kota: 'Bandung' }),
    ).toBe('Halo Budi di Bandung, {{x}}');
    expect(renderBroadcastMessage('Halo {{nama}}', undefined, { kota: 'a' })).toBe('Halo kak');
  });

  it('membedakan variabel yang tersedia dari yang salah ketik', () => {
    expect(broadcastUsedVars('Hai {{nama}} {{kota}} {{kota}}')).toEqual(['kota']);
    expect(unknownBroadcastPlaceholders('{{nama}} {{kota}} {{name}}', ['kota'])).toEqual(['name']);
  });

  it('masalah template: variabel tak dikenal, nilai kosong, dan hasil terlalu panjang', () => {
    const r: Array<{ name?: string; vars?: Record<string, string> }> = [
      { name: 'Budi', vars: { kota: 'Bandung' } },
      { name: 'Siti', vars: {} },
    ];
    expect(broadcastTemplateProblems('Halo {{nama}}', r)).toEqual([]);
    expect(broadcastTemplateProblems('Halo {{nama}} di {{kota}}', r)).toEqual([
      '1 penerima tidak punya nilai untuk {{kota}}',
    ]);
    expect(broadcastTemplateProblems('Halo {{kotta}}', r)[0]).toMatch(
      /Variabel tidak dikenal: \{\{kotta\}\}.*\{\{nama\}\}, \{\{kota\}\}/,
    );
    expect(
      broadcastTemplateProblems('{{a}}'.repeat(30), [{ vars: { a: 'z'.repeat(200) } }])[0],
    ).toMatch(/melebihi 4096/);
  });

  it('schema blast: variabel dari data penerima diterima, nilai kosong dan kunci buruk ditolak', () => {
    const base = {
      sessionId: '3f0c5d2e-6a1b-4c8e-9d7f-1a2b3c4d5e6f',
      name: 'Promo',
      message: 'Halo {{nama}} dari {{kota}}',
      consent: true,
      recipients: [
        { phone: '081234567890', name: 'Budi', vars: { kota: 'Bandung' } },
        { phone: '081311112222', vars: { kota: 'Medan' } },
      ],
    };
    expect(whatsappBroadcastSchema.safeParse(base).success).toBe(true);
    expect(
      whatsappBroadcastSchema.safeParse({
        ...base,
        recipients: [...base.recipients, { phone: '081400000000' }],
      }).success,
    ).toBe(false);
    expect(
      whatsappBroadcastSchema.safeParse({
        ...base,
        recipients: [{ phone: '081234567890', vars: { 'Kota!': 'x' } }],
      }).success,
    ).toBe(false);
    // Hanya {{nama}} bila tidak ada variabel: perilaku lama tetap.
    expect(
      whatsappBroadcastSchema.safeParse({
        ...base,
        message: 'Halo {{name}}!',
        recipients: [{ phone: '081234567890' }],
      }).success,
    ).toBe(false);
  });
});

describe('lampiran pengiriman terjadwal', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it('mengenali tipe dari isi file, bukan dari nama atau klaim klien', () => {
    expect(detectAttachmentMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('image/jpeg');
    expect(detectAttachmentMime(new TextEncoder().encode('%PDF-1.7\n...'))).toBe('application/pdf');
    // PNG, GIF, WebP, skrip, dan berkas kosong tidak didukung.
    expect(detectAttachmentMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBeNull();
    expect(detectAttachmentMime(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(detectAttachmentMime(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(detectAttachmentMime(bytes())).toBeNull();
    // %PDF- harus di awal file.
    expect(detectAttachmentMime(new TextEncoder().encode('  %PDF-1.4'))).toBeNull();
  });

  it('dengan lampiran, pesan dibatasi 1024 karakter sebagai caption', () => {
    const base = {
      sessionId: '3f0c5d2e-6a1b-4c8e-9d7f-1a2b3c4d5e6f',
      name: 'Promo',
      message: 'x'.repeat(100),
      consent: true,
      recipients: [{ phone: '081234567890', vars: { a: 'z'.repeat(200) } }],
    };
    const long = { ...base, message: '{{a}}'.repeat(6) }; // 1200 karakter setelah render
    expect(whatsappBroadcastSchema.safeParse(long).success).toBe(true);
    const withFile = whatsappBroadcastSchema.safeParse({
      ...long,
      attachmentId: '4a0c5d2e-6a1b-4c8e-9d7f-1a2b3c4d5e6f',
    });
    expect(withFile.success).toBe(false);
    expect(JSON.stringify(withFile)).toMatch(/melebihi 1024 karakter/);
    expect(whatsappBroadcastSchema.safeParse({ ...base, attachmentId: 'bukan-uuid' }).success).toBe(
      false,
    );
  });

  it('respons media tanpa ID dianggap status tidak pasti, seperti timeout', () => {
    expect(broadcastReasonText('send_failed:response_without_message_id')).toMatch(
      /status tidak pasti/,
    );
  });
});
