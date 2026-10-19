# Spesifikasi Integrasi Tracking — untuk Tim Backend & Landing Page Solid Mini

Dokumen ini menjelaskan cara Solid Mini mengirim data konversi ke **Solid Mini Growth Engine (SMGE)** agar tim
pemasaran dapat mengukur registrasi & aktivasi per campaign/akun TikTok. Hanya event dari **Conversion API**
(server-to-server) yang dianggap **terverifikasi**. Klik link tidak pernah dianggap bukti instalasi atau registrasi.

## Ringkasan alur

```text
TikTok (bio/video/DM) → https://<smge>/api/t/<kode>        (SMGE mencatat klik)
      ↓ 302
Landing / halaman registrasi Solid Mini
  ?utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…&smge_ref=<kode>&smge_vid=<id pengunjung>
      ↓ (simpan smge_ref & smge_vid sampai pengguna mendaftar)
Backend Solid Mini → POST https://<smge>/api/conversions     (REGISTRATION / ACTIVATION / …)
```

## 1. Yang perlu dilakukan landing page / aplikasi

1. Saat halaman dibuka, baca parameter `smge_ref` dan `smge_vid` dari URL, simpan (cookie first-party / localStorage /
   parameter deep link) sampai pengguna mendaftar.
2. Teruskan keduanya ke backend Solid Mini pada saat registrasi (mis. field tersembunyi di form atau parameter API
   registrasi), lalu simpan di data pengguna.
3. (Opsional) Kirim event kunjungan & klik dari browser:

```js
// Origin landing page harus terdaftar di TRACKING_ALLOWED_ORIGINS server SMGE.
const p = new URLSearchParams(location.search);
const ref = p.get('smge_ref');
const visitorId = p.get('smge_vid') ?? localStorage.getItem('smge_vid');
if (visitorId) localStorage.setItem('smge_vid', visitorId);

function track(type) {
  // type: 'LANDING_VISIT' | 'CTA_CLICK' | 'STORE_CLICK'
  fetch('https://<smge>/api/track/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ref, visitorId }),
    keepalive: true,
  });
}
track('LANDING_VISIT');
document.querySelector('#tombol-play-store')?.addEventListener('click', () => track('STORE_CLICK'));
```

Event dari browser ditandai **tidak terverifikasi**. `visitorId`: 8–64 karakter `[A-Za-z0-9_-]`.

## 2. Conversion API (server-to-server)

`POST https://<smge>/api/conversions` · `Content-Type: application/json`

### Autentikasi (HMAC-SHA256)

| Header | Nilai |
|---|---|
| `X-SMGE-Timestamp` | Unix time dalam **detik** saat request dibuat (toleransi ±5 menit) |
| `X-SMGE-Signature` | `hex(HMAC_SHA256(CONVERSION_API_SECRET, "<timestamp>.<body mentah>"))` |

`CONVERSION_API_SECRET` dibagikan lewat kanal aman (bukan chat/email biasa) dan disimpan di environment server.
Signature dihitung atas **byte body yang persis dikirim**.

### Body

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `eventId` | string ≤128 | ✅ | ID unik event di Solid Mini. **Kunci idempotensi** — kirim ulang dengan `eventId` sama aman |
| `type` | enum | ✅ | `INSTALL_VERIFIED`, `REGISTRATION`, `ACTIVATION`, `TRANSACTION`, `SUBSCRIPTION` |
| `occurredAt` | ISO-8601 | ✅ | Waktu kejadian, mis. `2026-10-19T08:15:00+07:00` |
| `externalUserId` | string ≤128 | ✅ | ID pengguna di Solid Mini |
| `ref` | string | – | Nilai `smge_ref` yang disimpan saat registrasi |
| `visitorId` | string | – | Nilai `smge_vid` yang disimpan saat registrasi |
| `utmSource`, `utmMedium`, `utmCampaign`, `utmContent` | string | – | UTM yang tersimpan (bila ada) |
| `value` | number | – | Nilai Rupiah untuk `TRANSACTION`/`SUBSCRIPTION` |
| `contact.email`, `contact.phone`, `contact.tiktokUsername` | string | – | Hanya untuk mencocokkan prospek di CRM SMGE; tidak disimpan ulang |

Definisi yang disarankan:

- `REGISTRATION`: akun berhasil dibuat.
- `ACTIVATION`: definisi "pengguna aktif" yang disepakati tim produk (mis. verifikasi selesai / aksi inti pertama).
- `INSTALL_VERIFIED`: hanya bila instalasi benar-benar terverifikasi (mis. dari MMP/SDK atribusi), **bukan** dari klik.

### Respons `200`

```json
{
  "ok": true,
  "eventId": "reg-1001",
  "duplicate": false,
  "leadMatched": true,
  "attribution": {
    "firstTouch": { "id": "…", "name": "Campaign B" },
    "lastTouch": { "id": "…", "name": "Campaign A" }
  }
}
```

| Kode | Arti | Tindakan |
|---|---|---|
| `200` | Diterima (atau duplikat: `duplicate: true`) | Selesai |
| `400` | Body tidak valid (`errors` per field) | Perbaiki payload, jangan diulang otomatis |
| `401` | Signature / timestamp tidak valid | Periksa secret & jam server |
| `503` | Conversion API belum dikonfigurasi di SMGE | Hubungi tim SMGE |
| `5xx` lainnya / timeout | Gangguan sementara | Ulangi dengan backoff, `eventId` sama |

### Contoh (Node.js)

```js
import { createHmac } from 'node:crypto';

async function sendConversion(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', process.env.SMGE_CONVERSION_API_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const res = await fetch('https://<smge>/api/conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SMGE-Timestamp': timestamp, 'X-SMGE-Signature': signature },
    body,
  });
  if (!res.ok && res.status >= 500) throw new Error(`SMGE ${res.status}`); // antrikan ulang
  return res.json();
}

await sendConversion({
  eventId: `registration:${user.id}`,
  type: 'REGISTRATION',
  occurredAt: user.createdAt.toISOString(),
  externalUserId: user.id,
  ref: user.smgeRef,
  visitorId: user.smgeVisitorId,
});
```

## 3. Atribusi di SMGE

- Touchpoint: klik/kunjungan dengan `visitorId` yang sama, `ref` pada event konversi, dan campaign sumber prospek CRM.
- Jendela atribusi: `ATTRIBUTION_LOOKBACK_DAYS` (default 30 hari sebelum konversi).
- **First-touch** = touchpoint paling awal; **Last-touch** = paling akhir. Laporan dapat dipilih per model.
- Event berikutnya untuk pengguna yang sama (mis. `ACTIVATION`) memakai `visitorId` dari event sebelumnya bila tidak dikirim.

## 4. Privasi

- Kirim hanya data yang diperlukan. `contact` bersifat opsional dan hanya dipakai untuk pencocokan.
- IP pengunjung tidak disimpan mentah (hanya hash bergaram) dan tidak ada data sensitif yang dibutuhkan.
