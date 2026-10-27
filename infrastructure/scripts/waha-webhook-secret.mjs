#!/usr/bin/env node
/**
 * Mencetak pengaturan webhook WAHA untuk SATU nama sesi (mode WAHA Core / satu sesi bersama), atau secret HMAC
 * per sesi. Secret diturunkan dari WAHA_WEBHOOK_MASTER_SECRET persis seperti API (apps/api/src/whatsapp/waha-signature.ts).
 *
 * Pemakaian:
 *   WAHA_WEBHOOK_MASTER_SECRET=... node infrastructure/scripts/waha-webhook-secret.mjs default http://api:4000/api/webhooks/waha
 *
 * Hasilnya dipasang sebagai environment container WAHA bila sesi "default" sudah ada sebelum SMGE membuatnya
 * (SMGE tidak mengubah konfigurasi sesi yang sudah ada).
 */
import { createHmac } from 'node:crypto';

const [name, base] = process.argv.slice(2);
const master = process.env.WAHA_WEBHOOK_MASTER_SECRET ?? '';
if (!name || !/^[A-Za-z0-9._-]{1,100}$/.test(name) || master.length < 32) {
  console.error(
    'Pemakaian: WAHA_WEBHOOK_MASTER_SECRET=<min 32 karakter> node waha-webhook-secret.mjs <nama-sesi> [url-dasar-webhook]',
  );
  process.exit(1);
}
const secret = createHmac('sha256', master).update(`waha-session-v1:${name}`).digest('hex');
if (base) {
  console.log(`WHATSAPP_HOOK_URL=${base.replace(/\/+$/, '')}/${name}`);
  console.log('WHATSAPP_HOOK_EVENTS=message,message.any,message.ack,session.status');
  console.log(`WHATSAPP_HOOK_HMAC_KEY=${secret}`);
} else {
  console.log(secret);
}
