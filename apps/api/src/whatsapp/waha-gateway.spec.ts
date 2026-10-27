import { parseChats, parseContacts, parseMessageId } from './waha-gateway';
import { parseWahaMessage } from './whatsapp-ingest.service';

/** Bentuk di bawah mengikuti respons NOWEB WAHA 2026.9.2 yang diamati langsung (nilainya sintetis). */
const realChat = {
  id: '6281234567890@s.whatsapp.net',
  readOnly: false,
  conversationTimestamp: 1_790_000_000,
  archived: false,
  accountLid: '123456789012345@lid',
};
const realMessage = (fromMe: boolean) => ({
  id: `${fromMe}_6281234567890@c.us_3EB0AAAABBBBCCCCDDDD`,
  timestamp: 1_790_000_100,
  from: fromMe ? '628111222333@c.us' : '6281234567890@c.us',
  fromMe,
  source: 'app',
  body: 'Halo kak',
  hasMedia: false,
  media: null,
  ack: fromMe ? 3 : null,
  ackName: 'READ',
  _data: { key: {}, message: {}, messageTimestamp: 1_790_000_100 },
});

describe('respons store WAHA', () => {
  it('menormalkan JID chat mentah Baileys ke bentuk @c.us dan membaca waktu terakhir', () => {
    const [c] = parseChats([realChat, { id: 7 }, null]);
    expect(c).toEqual({ id: '6281234567890@c.us', name: null, lastTimestamp: 1_790_000_000 });
    expect(parseChats([{ id: '120363@g.us' }, { id: '1@lid' }]).map((x) => x.id)).toEqual([
      '120363@g.us',
      '1@lid',
    ]);
    expect(() => parseChats({})).toThrow();
  });

  it('menerima waktu dalam milidetik dan id berbentuk objek', () => {
    const [c] = parseChats([
      { id: { _serialized: '6281@s.whatsapp.net' }, conversationTimestamp: '1790000000000' },
    ]);
    expect(c).toMatchObject({ id: '6281@c.us', lastTimestamp: 1_790_000_000 });
  });

  it('pesan keluar dari store tanpa field `to` tetap terbaca bila chat diketahui', () => {
    const out = parseWahaMessage(realMessage(true), '6281234567890@c.us');
    expect(out).toMatchObject({
      ok: true,
      msg: {
        jid: '6281234567890@c.us',
        fromMe: true,
        externalId: '3EB0AAAABBBBCCCCDDDD',
        status: 'READ',
      },
    });
    // Tanpa chat yang diketahui (jalur webhook), pesan keluar tanpa `to` memang tidak bisa dipetakan.
    expect(parseWahaMessage(realMessage(true))).toEqual({
      ok: false,
      reason: 'chat_not_supported',
    });
    const inn = parseWahaMessage(realMessage(false), '6281234567890@c.us');
    expect(inn).toMatchObject({ ok: true, msg: { fromMe: false, status: 'RECEIVED' } });
  });

  it('membaca kontak dan ID pesan dari bentuk yang berbeda antar versi', () => {
    expect(
      parseContacts([
        { id: '6281111111111@c.us', name: 'Budi', isMe: false },
        { id: '6282222222222@c.us', pushname: 'Siti' },
        { id: '6283333333333@c.us', isMe: true, name: 'Saya' },
        { id: '120363000000@g.us', name: 'Grup', isGroup: true },
        { id: '6284444444444@c.us' },
      ]),
    ).toEqual([
      { phone: '6281111111111', name: 'Budi', saved: true, lid: null },
      { phone: '6282222222222', name: 'Siti', saved: false, lid: null },
    ]);
    expect(parseMessageId({ id: 'true_x@c.us_ABC' })).toBe('true_x@c.us_ABC');
    expect(parseMessageId({ id: { _serialized: 'S' } })).toBe('S');
    expect(parseMessageId({ key: { id: 'K' } })).toBe('K');
    expect(parseMessageId({})).toBeNull();
  });

  it('kontak @lid dipetakan ke nomor lewat phoneNumber dan digabung dengan entri nomor yang sama', () => {
    const out = parseContacts([
      { id: '6281111111111@c.us', name: 'Budi', lid: '123456789012345@lid' },
      { id: '987654321098765@lid', pushname: 'Siti', phoneNumber: '6282222222222@s.whatsapp.net' },
      { id: '555555555555555@lid', pushname: 'Tanpa Nomor' },
      { id: '6281111111111@s.whatsapp.net', pushname: 'Budi (profil)' },
    ]);
    expect(out).toEqual([
      { phone: '6281111111111', name: 'Budi', saved: true, lid: '123456789012345' },
      { phone: '6282222222222', name: 'Siti', saved: false, lid: '987654321098765' },
    ]);
  });

  it('nama tersimpan menggantikan nama profil pada entri ganda, dan sebaliknya tidak', () => {
    const profileFirst = parseContacts([
      {
        id: '6281111111111@lid',
        pushname: 'Budi Profil',
        phoneNumber: '6281111111111@s.whatsapp.net',
      },
      { id: '6281111111111@c.us', name: 'Budi Tersimpan' },
    ]);
    expect(profileFirst).toMatchObject([{ name: 'Budi Tersimpan', saved: true }]);
    const savedFirst = parseContacts([
      { id: '6281111111111@c.us', name: 'Budi Tersimpan' },
      {
        id: '6281111111111@lid',
        pushname: 'Budi Profil',
        phoneNumber: '6281111111111@s.whatsapp.net',
      },
    ]);
    expect(savedFirst).toMatchObject([{ name: 'Budi Tersimpan', saved: true }]);
  });
});
