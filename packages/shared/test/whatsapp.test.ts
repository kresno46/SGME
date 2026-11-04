import { describe, expect, it } from 'vitest';
import {
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
