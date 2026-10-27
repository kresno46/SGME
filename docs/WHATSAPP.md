# WhatsApp via WAHA

Menu **WhatsApp** di sidebar memberi chat dua arah lewat nomor WhatsApp milik user sendiri. Satu user boleh
menautkan **beberapa nomor** (batas `WAHA_MAX_SESSIONS_PER_USER`, default 3). Chat masuk disimpan di SMGE, dan
balasan dikirim manusia dari dashboard. Tidak ada balasan otomatis, tidak ada kirim massal.

## Risiko yang harus diterima

1. **WAHA bukan jalur resmi WhatsApp.** WAHA menjalankan WhatsApp Web di server. Pemakaian otomatis dapat
   melanggar ketentuan WhatsApp dan **nomor bisa diblokir**. Pakai nomor khusus, bukan nomor utama bisnis.
   Jalur resmi adalah WhatsApp Business Platform (Meta).
2. **Versi WAHA.** Sejak WAHA **2026.6.1**, fitur yang dulu hanya di WAHA Plus (sesi tanpa batas, dll.) masuk ke
   WAHA Core yang gratis, dan tidak ada image Plus terpisah: pakai `devlikeapro/waha`. Versi lebih lama membatasi
   satu sesi bernama `default`; untuk itu lihat `WAHA_SESSION_NAME` di bawah. Cek versi Anda:
   `curl -H "X-Api-Key: <kunci>" http://127.0.0.1:3050/api/server/version`.
3. Satu layanan tambahan dengan sesi WhatsApp yang harus dijaga (memori, volume sesi).

## Mode

| Mode                               | `WAHA_SESSION_NAME` | WAHA       | Perilaku                                                                                            |
| ---------------------------------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| Banyak nomor (default, disarankan) | kosong              | ≥ 2026.6.1 | Tiap user menambah nomor sendiri, sampai `WAHA_MAX_SESSIONS_PER_USER`. Nama sesi `u-<uuid>-<acak>`. |
| Satu nomor bersama (WAHA lama)     | `default`           | < 2026.6.1 | Seluruh server hanya punya satu nomor; user lain mendapat 409. Batas per user dianggap 1.           |

Berpindah dari mode satu nomor ke banyak nomor aman: nomor `default` yang sudah ada tetap berfungsi (webhooknya
tetap valid) dan bisa diberi nama baru.

## Konfigurasi

```dotenv
WAHA_ENABLED=true
WAHA_BASE_URL=http://waha:3000                  # alamat WAHA dari sisi API
WAHA_API_KEY=<openssl rand -hex 16>             # sama dengan WAHA_API_KEY di container WAHA
WAHA_PUBLIC_WEBHOOK_BASE_URL=http://api:4000/api/webhooks/waha
WAHA_WEBHOOK_MASTER_SECRET=<openssl rand -hex 32>
WAHA_MAX_SESSIONS_PER_USER=3                    # nomor per user
WAHA_SESSION_NAME=                              # isi "default" hanya untuk WAHA < 2026.6.1
```

API menolak start bila `WAHA_ENABLED=true` tetapi konfigurasi tidak lengkap, dan di produksi bila nilainya masih
contoh. Daftar lengkap variabel (batas kirim, jeda, batas sesi) ada di `.env.example`.

- **Development:** `docker compose --profile waha up -d waha` (port `127.0.0.1:3050`, volume `wahadata` menyimpan sesi).
  Tanpa `docker compose`, tambahkan volume (`-v waha_sessions:/app/.sessions`) pada `docker run`, kalau tidak nomor yang
  sudah dipindai hilang saat container dihapus.
  Webhook dari container ke API di host: `http://host.docker.internal:4000/api/webhooks/waha`.
- **Produksi:** `docker-compose.waha.yml` menambah layanan `waha` di jaringan internal tanpa port publik;
  `smge.sh` memasangnya otomatis bila `WAHA_ENABLED=true`. Webhook lewat `http://api:4000/api/webhooks/waha`.
- Setelah upgrade, jalankan ulang seed (`pnpm db:seed`; produksi: layanan `migrate` otomatis) agar permission
  `whatsapp:use` masuk ke role Admin dan Marketing Operator. Viewer tidak mendapat akses.

## Pemakaian

1. **WhatsApp → Nomor saya → Tambah nomor.** Beri nama (mis. "CS 1"). SMGE membuat sesi di WAHA, memasang webhook
   bertanda tangan, lalu menampilkan QR di kartu nomor itu. Pindai dari WhatsApp di ponsel (Perangkat tertaut).
   Ulangi untuk nomor berikutnya sampai batas.
2. Pesan masuk muncul di tab **Chat**. Bila Anda punya lebih dari satu nomor, tersedia filter nomor dan setiap chat
   diberi nama nomornya. **Balasan selalu keluar dari nomor tempat chat itu berada**; tidak ada pemilih "kirim dari".
   Pelanggan yang sama yang menulis ke dua nomor menjadi dua chat terpisah.
3. Di tiap kartu nomor: **Hentikan sesi**, **Putuskan nomor**, **Atur ulang sesi** (hanya untuk sesi macet; ditolak bila
   nomor masih tersambung), ganti nama, dan **Hapus nomor**. Hapus hanya bila nomor belum tersambung **dan tidak punya
   chat**, jadi riwayat chat tidak pernah terhapus diam-diam.
4. **Chat baru** (ikon di samping kolom pencarian): ketik nama kontak atau nomor lengkap (0812…, +62812…, dan 62812…
   sama saja), lalu pilih. Lihat bagian _Memulai chat duluan_ di bawah.
5. Super Admin melihat tab **Semua nomor** (nama nomor, pemilik, status, bisa menghentikan/memutus per nomor) dan chat
   semua user. Super Admin tidak dapat mengelola atau membalas di nomor milik orang lain.

Bila sesi (mis. `default`) sudah ada di WAHA sebelum SMGE membuatnya, SMGE **tidak mengubah konfigurasinya**. Pasang
webhook lewat environment container WAHA dengan:

```bash
WAHA_WEBHOOK_MASTER_SECRET=... node infrastructure/scripts/waha-webhook-secret.mjs default http://api:4000/api/webhooks/waha
```

## Memulai chat duluan

Tombol **Chat baru** di inbox membuka satu kolom: ketik nama untuk mencari di **kontak ponsel**, atau ketik **nomor
lengkap**. Memilih hanya membuka ruang chat; pesan pertama tetap Anda tulis dan kirim sendiri lewat alur kirim yang
sama (semua pengaman di bawah berlaku). Satu per satu: tidak ada kirim massal.

- **Nomor dicek dulu** ke WhatsApp (`check-exists`). Nomor yang tidak terdaftar ditolak (422), karena mengirim ke
  nomor tanpa WhatsApp menaikkan risiko blokir.
- **Batas chat baru per nomor per hari** (`WAHA_NEW_CHATS_PER_DAY`, default 20, hari WIB). Chat yang sudah ada (termasuk
  dari pesan masuk, juga yang berbentuk `@lid` dengan nomor yang sama) langsung dibuka dan tidak memakai jatah.
- **Ditolak** bila nomor ada di daftar larangan kontak, nomor itu adalah nomor Anda sendiri, nomor belum `WORKING`,
  atau sesinya milik orang lain (404).
- Chat baru yang tidak pernah dikirimi pesan dibersihkan worker setelah 24 jam.
- Nomor tidak ditulis ke log audit; yang dicatat hanya `whatsapp.chat.start` dengan ID chat.

### Kontak ponsel (opsional)

Daftar kontak ponsel hanya tersedia bila sesi dibuat dengan **NOWEB store + full sync**. Aktifkan dengan
`WAHA_CONTACTS_SYNC=true` (atau `WAHA_HISTORY_SYNC=true`, yang memakai konfigurasi yang sama); konfigurasi itu dipasang pada nomor yang **baru** ditambahkan.

- **Konsekuensi privasi dan sumber daya:** WAHA menyimpan **seluruh riwayat chat ponsel** di volumenya (bukan hanya
  kontak) dan sinkronisasi awal bisa berat untuk akun yang besar. SMGE sendiri hanya membaca kontak. Karena itu
  defaultnya mati.
- **Nomor yang sudah tertaut tidak ikut tersinkron**: sinkronisasi hanya terjadi saat pemindaian pertama. Putuskan
  nomor, hapus/atur ulang sesinya, lalu pindai ulang setelah mengaktifkan opsi ini.
- Tanpa opsi ini, kolom pencarian tetap bisa dipakai untuk mengetik nomor lengkap; dialog menjelaskan bahwa kontak
  belum tersinkron.

## Riwayat chat dari ponsel (sinkron otomatis)

Tanpa ini, inbox hanya berisi pesan yang masuk **setelah** nomor ditautkan. Dengan `WAHA_HISTORY_SYNC=true`, SMGE
mengimpor riwayat chat 1:1 dari ponsel supaya konteks percakapan sebelumnya ikut terbawa saat Anda membalas prospek.

- **Cara kerja:** nomor baru dibuat dengan NOWEB store aktif, sehingga WAHA menyimpan riwayat yang dikirim WhatsApp
  setelah pemindaian. Penjadwal di API membaca daftar chat dan pesan dari WAHA lalu menyimpannya di SMGE. Putaran
  awal berdekatan (4 kali, jarak 10 menit) karena riwayat tiba bertahap, lalu penyusul tiap 6 jam. Tombol
  **Sinkronkan sekarang** di kartu nomor menjalankannya segera.
- **Batas:** hanya chat 1:1 dengan pesan dalam `WAHA_HISTORY_DAYS` (default 30) terakhir, paling banyak
  `WAHA_HISTORY_MAX_CHATS` (200) chat dan `WAHA_HISTORY_MESSAGES_PER_CHAT` (50) pesan per chat. Grup, status, dan
  channel tidak diimpor. Lampiran hanya berupa penanda `[Lampiran: …]`.
- **Aman diulang:** pesan yang sama (ID WhatsApp) tidak digandakan, termasuk terhadap webhook dan balasan dari SMGE.
  Riwayat **tidak menambah "belum dibaca"** dan tidak memakai jatah chat baru per hari. Chat yang sudah lebih baru dan
  nama kontak yang sudah ada tidak ditimpa.
- **Pengaman balas ikut bekerja pada riwayat:** bila pesan terakhir pelanggan di riwayat adalah "stop/berhenti",
  balasan diblokir sampai ia menulis hal lain.
- **Lease di database** mencegah API, worker, atau replika menyinkronkan nomor yang sama bersamaan (basi 15 menit).
- **Pasangan baru:** begitu nomor kembali menunggu QR (hasil putus/atur ulang/pindai ulang), progres riwayat diulang
  dari awal.

**Privasi, baca sebelum mengaktifkan.** Semua chat 1:1 dalam jendela hari itu masuk ke database SMGE, **termasuk chat
pribadi dan keluarga**, bukan hanya prospek. Chat itu terlihat oleh pemilik nomor dan **Super Admin**. Selain itu WAHA
menyimpan seluruh riwayat ponsel di volumenya. Untuk menguranginya, perkecil `WAHA_HISTORY_DAYS`, dan gunakan nomor
khusus pemasaran. Defaultnya mati.

**Hanya berlaku pada nomor yang dipindai setelah opsi aktif.** WhatsApp mengirim riwayat hanya saat pemindaian
pertama. Nomor yang sudah tertaut sebelumnya menunjukkan "belum bisa disinkronkan" (`store_disabled`): putuskan nomor,
**Mulai sesi**, **Atur ulang sesi**, lalu pindai ulang.

**Belum terverifikasi:** bentuk respons `/api/{sesi}/chats` dan `/chats/{id}/messages` mengikuti dokumentasi WAHA dan
dibaca secara defensif, tetapi belum diuji dengan store berisi data nyata (sandbox tidak punya nomor terpindai).
Bila hasil impor kosong atau aneh, `historyError` pada kartu nomor menunjukkan kodenya.

## Kirim terjadwal ke daftar terpilih

Tab **Kirim terjadwal** mengirim **satu pesan ke daftar kecil orang yang Anda kenal**, bertahap, bukan blast massal.
Aktifkan dengan `WAHA_BROADCAST_ENABLED=true` (default mati).

**Cara pakai:** _Kirim terjadwal baru_ → pilih nomor → tulis pesan (`{{nama}}` diganti nama penerima, atau "kak" bila
tidak ada) → pilih penerima dari **kontak tersimpan** di ponsel (daftar dengan centang, bisa pilih banyak, kontak yang
hanya punya nama profil tidak ditampilkan) dan/atau ketik nomor (satu per baris: `nomor` atau `nama, nomor`) → centang konfirmasi bahwa semua penerima mengenal Anda dan setuju dihubungi → **Mulai kirim**.
Kemajuan, jeda, lanjutkan, dan batalkan ada di kartu pengirimannya.

**Aturan:**

- **Maksimal `WAHA_BROADCAST_MAX_RECIPIENTS` penerima** (default 50) per pengiriman. Nomor dinormalisasi dan didedupe.
- **Bertahap:** satu penerima per putaran dengan jeda acak `WAHA_BROADCAST_MIN/MAX_DELAY_SECONDS` (20 sampai 60 detik).
- **Batas harian per nomor:** `WAHA_BROADCAST_PER_DAY` (default 30, hari WIB). Sisanya lanjut otomatis keesokan harinya.
- **Setiap penerima melewati alur "Chat baru" lalu "kirim" yang sama dengan pengiriman manual**, jadi ikut berlaku: cek
  nomor terdaftar di WhatsApp, daftar larangan kontak (dilewati), pelanggan yang pernah minta "stop" (dilewati), nomor
  sendiri (dilewati), batas chat baru per hari, dan pembatas kirim.
- **Tiga kegagalan berturut-turut menjeda otomatis** (tanda nomor bermasalah), alih-alih terus mencoba.
- **Nomor terputus menjeda** tanpa kehilangan penerima; lanjutkan setelah tersambung.
- **Aman terhadap proses yang mati:** setiap penerima memakai ID kirim tetap, jadi tidak terkirim dua kali. Gagal
  karena _timeout_ berarti status tidak pasti (periksa ponsel sebelum mengirim ulang) dan **tidak diulang otomatis**.
- **Isolasi:** hanya pemilik nomor yang melihat dan mengelola pengirimannya (Super Admin pun tidak).
- **Audit:** pembuatan, jeda, lanjut, batal, dan tiap pesan tercatat; nomor penerima dan isi pesan tidak masuk audit.

**Risiko, baca sebelum memakai.** WAHA bukan jalur resmi WhatsApp. Pesan beruntun dengan isi yang sama ke banyak
orang adalah pola yang dipakai WhatsApp untuk mendeteksi spam, walau jeda acak dan batas harian menurunkannya.
Penerima yang tidak mengenal Anda dan melaporkan pesan adalah penyebab blokir paling umum. Fitur ini dirancang untuk
puluhan kontak yang sudah kenal, **bukan** untuk nomor asing atau ratusan penerima: untuk itu pakai WhatsApp Business
Platform resmi (template disetujui Meta, wajib opt-in), yang belum diintegrasikan di SMGE.

**Belum ada:** variasi isi pesan otomatis, penjadwalan jam mulai, pemilihan penerima dari prospek CRM, dan lampiran. Daftar kontak tersimpan butuh sinkron kontak aktif (nomor dipindai setelah `WAHA_CONTACTS_SYNC` atau `WAHA_HISTORY_SYNC` menyala).

## Aturan yang ditegakkan

- **Kepemilikan data.** Chat milik user pemilik nomor. User lain (termasuk Admin) mendapat 404; Super Admin dapat
  membaca semua chat tetapi **tidak dapat membalas** di nomor milik orang lain. ID nomor milik orang lain dianggap tidak
  ada (404) pada semua operasi sesi.
- **Webhook fail-closed.** `POST /api/webhooks/waha/:kunci` wajib `X-Webhook-Hmac` (HMAC-SHA512 atas body mentah).
  Secret tiap sesi diturunkan dari `WAHA_WEBHOOK_MASTER_SECRET` dan nama sesi, tidak disimpan. Tanpa tanda tangan,
  tanda tangan salah, atau kunci tak dikenal: 401 dengan pesan yang sama. Pemilik chat selalu dari baris sesi di
  database, tidak pernah dari body.
- **Hanya chat 1:1** (`@c.us`, `@lid`). Grup, status, broadcast, dan channel diabaikan. Lampiran disimpan sebagai
  penanda `[Lampiran: <mimetype>]`; berkasnya tidak diunduh.
- **Idempotensi.** Event yang sama tidak menggandakan pesan; gema pesan yang dikirim dari SMGE diadopsi.
  Mengirim ulang dengan `clientMessageId` yang sama tidak mengirim dua kali.
- **Tulis dulu, kirim kemudian.** Pesan keluar disimpan `SENDING` sebelum memanggil WAHA. Yang macet lebih dari
  `WAHA_SEND_STUCK_SECONDS` ditandai gagal oleh worker. Gagal karena **timeout** berarti status tidak pasti:
  pesan mungkin sudah terkirim, periksa ponsel sebelum mengirim ulang.
- **Kirim ditolak** bila nomor belum `WORKING`, pelanggan baru saja menulis "stop/berhenti/…" (dibuka lagi setelah
  ia menulis hal lain), atau nomornya ada di **daftar larangan kontak** (DNC, kanal telepon).
- **Pembatas kirim** di memori proses: jeda minimum + acak antar pesan per nomor, dan batas per menit per chat dan
  per nomor (429). Dengan beberapa replika API, batas berlaku per replika.
- **Status koneksi.** Dari webhook `session.status` dan worker (tiap menit). Nomor yang turun dari `WORKING` bukan
  karena tindakan user ditandai terputus dan tampil sebagai spanduk di halaman WhatsApp.
- **Audit.** Mulai/berhenti/putus sesi dan setiap pengiriman dicatat; isi pesan tidak masuk audit, log, atau pesan error.

## Endpoint

| Method | Path                                                | Akses               | Keterangan                                                                       |
| ------ | --------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| GET    | `/whatsapp/config`                                  | `whatsapp:use`      | `{ enabled, maxSessionsPerUser, singleSession }`                                 |
| GET    | `/whatsapp/sessions`                                | `whatsapp:use`      | Nomor milik sendiri + status langsung dari WAHA (satu panggilan)                 |
| GET    | `/whatsapp/sessions/health`                         | `whatsapp:use`      | `{ linked, connectionLost, lostLabels }` dari data tersimpan, tanpa WAHA         |
| POST   | `/whatsapp/sessions`                                | `whatsapp:use`      | `{ label (1–40) }` tambah nomor dan jalankan; 409 bila batas tercapai            |
| PATCH  | `/whatsapp/sessions/:id`                            | `whatsapp:use`      | `{ label }` ganti nama                                                           |
| DELETE | `/whatsapp/sessions/:id`                            | `whatsapp:use`      | Hanya bila belum tersambung dan tanpa chat                                       |
| GET    | `/whatsapp/sessions/:id/contacts`                   | `whatsapp:use`      | `?search=` kontak ponsel (maks. 50); `available=false` bila sinkronisasi mati    |
| POST   | `/whatsapp/sessions/:id/chats`                      | `whatsapp:use`      | `{ phone, name? }` buka chat dengan nomor; 422 tidak terdaftar, 429 batas harian |
| POST   | `/whatsapp/sessions/:id/sync-history`               | `whatsapp:use`      | Jalankan impor riwayat sekarang (latar belakang); `{ started }`                  |
| GET    | `/whatsapp/broadcasts`                              | `whatsapp:use`      | Pengiriman terjadwal milik sendiri + kemajuan                                    |
| POST   | `/whatsapp/broadcasts`                              | `whatsapp:use`      | `{ sessionId, name, message, recipients[{phone,name?}], consent:true }`          |
| GET    | `/whatsapp/broadcasts/:id`                          | `whatsapp:use`      | Detail + status tiap penerima                                                    |
| POST   | `/whatsapp/broadcasts/:id/{pause,resume,cancel}`    | `whatsapp:use`      | Jeda, lanjutkan, batalkan                                                        |
| POST   | `/whatsapp/sessions/:id/{start,stop,logout,reset}`  | `whatsapp:use`      | Kelola satu nomor sendiri                                                        |
| GET    | `/whatsapp/sessions/:id/qr`                         | `whatsapp:use`      | Gambar QR (`no-store`); 404 bila belum siap                                      |
| GET    | `/whatsapp/chats`                                   | `whatsapp:use`      | `page`, `pageSize`, `search`, `unreadOnly`, `sessionId`; + `unreadTotal`         |
| GET    | `/whatsapp/chats/:id`                               | `whatsapp:use`      | Pesan terakhir (maks. 200), `canReply`, `replyBlockedReason`                     |
| POST   | `/whatsapp/chats/:id/read`                          | `whatsapp:use`      | Tandai terbaca di SMGE                                                           |
| POST   | `/whatsapp/chats/:id/send`                          | `whatsapp:use`      | `{ text (1–4096), clientMessageId (8–64, [A-Za-z0-9_-]) }`                       |
| GET    | `/whatsapp/admin/sessions`                          | Super Admin         | Semua nomor + status                                                             |
| POST   | `/whatsapp/admin/sessions/:sessionId/{stop,logout}` | Super Admin         | Hentikan/putuskan satu nomor; tidak ada hapus                                    |
| POST   | `/webhooks/waha/:kunci`                             | publik, HMAC-SHA512 | Event `message`, `message.any`, `message.ack`, `session.status`                  |

## Keterbatasan

- Teks saja. Lampiran masuk/keluar, balasan-kutipan, dan indikator mengetik belum ada.
- Memulai chat satu per satu dari kontak ponsel atau nomor yang diketik; belum ada pemilihan dari prospek CRM.
- Bentuk respons kontak WAHA (`/api/contacts/all`) mengikuti dokumentasi dan diuji dengan server tiruan; endpoint
  asli baru terverifikasi menolak (400) saat store mati. Cek `/api/contacts/check-exists` terverifikasi pada WAHA asli.
- Chat belum otomatis ditautkan ke prospek CRM (nomor tersimpan di chat; pencocokan ke prospek menyusul).
- Permintaan berhenti dari pelanggan memblokir balasan tetapi belum otomatis masuk DNC.
- Diuji dengan WAHA Core 2026.9.2 sungguhan: membuat beberapa sesi sekaligus, webhook bertanda tangan, status, dan QR
  per nomor. Pengiriman dan penerimaan pesan nyata butuh nomor yang dipindai dan belum diuji.
- Satu nomor WhatsApp hanya boleh tertaut ke satu sesi; menautkan nomor yang sama di dua slot membuat WhatsApp
  mengeluarkan salah satunya.
- Pembatas kirim dan jeda berada di memori proses (per replika).

## Pengembangan

```bash
pnpm --filter @smge/shared test
pnpm --filter @smge/api test                                   # termasuk waha-signature & send-limiter
pnpm --filter @smge/api test:e2e --testPathPattern whatsapp    # gateway WAHA palsu, tanpa jaringan
```
