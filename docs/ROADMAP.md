# Roadmap & Status

## Fase 1 — Fondasi ✅ (15 Oktober 2026)

| Item                                                                                                                    | Status                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Monorepo pnpm, TypeScript, ESLint, Prettier                                                                             | ✅                                                                             |
| Rancangan database lengkap (25 tabel) + migrasi awal + seed                                                             | ✅                                                                             |
| NestJS API: konfigurasi tervalidasi, Prisma, filter error berbahasa Indonesia                                           | ✅                                                                             |
| Autentikasi: Argon2id, JWT + refresh token berotasi, deteksi reuse, CSRF, lockout, rate limit                           | ✅                                                                             |
| 2FA TOTP, reset password (email/SMTP opsional), ganti password, manajemen sesi                                          | ✅                                                                             |
| RBAC 4 role + manajemen pengguna + log audit                                                                            | ✅                                                                             |
| Manajemen akun TikTok (CRUD, filter, pagination, status integrasi, label sumber data)                                   | ✅                                                                             |
| Health check (database + Redis)                                                                                         | ✅                                                                             |
| Dashboard Next.js: login + 2FA, layout 10 menu, dark/light mode, responsif, ringkasan + grafik, akun TikTok, pengaturan | ✅                                                                             |
| `docker-compose.yml` untuk PostgreSQL + Redis (development)                                                             | ✅ ditulis, **belum dijalankan** (Docker tidak tersedia di mesin pengembangan) |

### Hasil verifikasi Fase 1

| Pemeriksaan                                                      | Hasil                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm lint`                                                      | 0 error, 0 warning                                                  |
| `pnpm typecheck`                                                 | lulus (semua package)                                               |
| Unit test `@smge/shared` (Vitest)                                | 12/12 lulus                                                         |
| Unit test API (Jest)                                             | 16/16 lulus                                                         |
| Integration test API (Jest + Supertest + PostgreSQL `smge_test`) | 25/25 lulus                                                         |
| `next build` dashboard                                           | lulus (17 route)                                                    |
| Uji manual via browser (Edge, light/dark, desktop/mobile)        | login, dashboard, akun TikTok, form validasi, pengguna tampil benar |

### Keterbatasan yang diketahui

- **Email:** tanpa `SMTP_HOST`, link reset password hanya ditulis ke log server. Produksi wajib mengisi SMTP.
- **Rate limit** disimpan di memori proses API. Untuk lebih dari satu instance API, pindahkan storage
  throttler ke Redis (direncanakan bersama BullMQ).
- **`next build` output standalone** (untuk image Docker) diaktifkan dengan `NEXT_OUTPUT=standalone`; di Windows
  membutuhkan hak membuat symlink, jadi di sana dimatikan secara default.
- **Unit test komponen dashboard** belum ada; dashboard divalidasi lewat typecheck, lint, build, dan uji manual.

## Fase 2 — CRM & Campaign ✅ (16 Oktober 2026)

| Item                                                                                                                                                                                  | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Campaign: CRUD, 7 jenis & 6 status, akun sejalur, operator, kode tracking unik, anggaran & biaya manual, statistik + biaya per lead                                                   | ✅     |
| CRM prospek: CRUD, deduplikasi (username/email/telepon ternormalisasi), segmentasi (status, ketertarikan, sumber, akun, campaign, operator, izin, tag, follow-up)                     | ✅     |
| Izin komunikasi per kanal dengan bukti wajib; pencabutan membatalkan tugas terkait                                                                                                    | ✅     |
| Daftar larangan kontak (DNC) lintas kanal, termasuk saat prospek dibuat & import                                                                                                      | ✅     |
| Riwayat aktivitas (timeline) + catatan                                                                                                                                                | ✅     |
| Import CSV (pratinjau, duplikat dalam file & database, DNC, pernyataan dasar hukum wajib)                                                                                             | ✅     |
| Export CSV/Excel sesuai permission, tercatat di audit                                                                                                                                 | ✅     |
| Hapus data pribadi (anonimisasi)                                                                                                                                                      | ✅     |
| Template pesan dengan placeholder tervalidasi                                                                                                                                         | ✅     |
| Outbound Workstation: antrean berprioritas (skor + alasan), review wajib, kirim **manual** dengan konfirmasi, catat balasan, follow-up terbatas, opt-out → DNC, batas harian per akun | ✅     |
| Worker BullMQ + kebijakan retensi data (dry-run & endpoint manual Super Admin)                                                                                                        | ✅     |

### Hasil verifikasi Fase 2

| Pemeriksaan                                                      | Hasil                                                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                      | 0 error, 0 warning                                                                                                                                                                                  |
| `pnpm typecheck`                                                 | lulus (semua package)                                                                                                                                                                               |
| Unit test `@smge/shared` (Vitest)                                | 27/27 lulus                                                                                                                                                                                         |
| Unit test API (Jest)                                             | 19/19 lulus                                                                                                                                                                                         |
| Integration test API (Jest + Supertest + PostgreSQL `smge_test`) | 54/54 lulus (7 suite)                                                                                                                                                                               |
| `next build` dashboard                                           | lulus (18 route)                                                                                                                                                                                    |
| Worker BullMQ terhadap Redis lokal                               | berjalan; jadwal retensi harian terdaftar                                                                                                                                                           |
| Uji alur di browser (Edge)                                       | campaign, prospek (deteksi duplikat), detail & timeline, pratinjau import, outbound lengkap sampai kirim manual (tombol simpan nonaktif sebelum konfirmasi dicentang), template, mode gelap, mobile |

### Keterbatasan Fase 2

- **Registrasi masih konfirmasi manual operator** (`registeredAt` dari hasil tugas/ubah status). Verifikasi dari
  backend Solid Mini menyusul di Fase 5.
- **Antrean outbound** mengurutkan maksimal 500 kandidat terbaru per permintaan; untuk volume besar gunakan pencarian
  atau filter campaign. Skor prioritas masih berbasis aturan; skor AI menyusul di Fase 3.
- **Batas harian** dihitung per hari kalender WIB (`Asia/Jakarta`), terlepas dari zona waktu server.
- **Draft pesan belum dibuat AI** — memakai template (AI Message Generator di Fase 3).
- **Notifikasi follow-up** hanya berupa daftar "jatuh tempo" di dashboard; belum ada notifikasi email/push.
- Halaman AI Sales, Percakapan, Analitik, dan Integrasi masih berupa placeholder yang menampilkan rencana fiturnya.

## Fase 3 — AI Sales ✅ (16 Oktober 2026) — menunggu API key untuk aktif

| Item                                                                                          | Status                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Integrasi OpenAI (Chat Completions + Structured Outputs), model dapat dikonfigurasi           | ✅ kode siap; **belum diuji ke OpenAI sungguhan** (API key belum diberikan) |
| Knowledge Base: CRUD, kategori, status terbit, versi, pemilihan konteks berdasarkan relevansi | ✅ (isi masih kosong — menunggu materi resmi Solid Mini)                    |
| Tanya jawab KB + human handoff                                                                | ✅                                                                          |
| AI Message Generator (draft outbound personal, diterapkan manual oleh operator)               | ✅                                                                          |
| AI Reply Suggestion (Copilot)                                                                 | ✅                                                                          |
| AI Lead Scoring & ringkasan riwayat (tercatat di timeline)                                    | ✅                                                                          |
| Guardrail klaim terlarang (server memblokir; UI memberi peringatan saat mengetik)             | ✅                                                                          |
| Tracking token, biaya (harga diatur admin), batas biaya bulanan, rate limit AI                | ✅                                                                          |
| Mode Copilot; Auto-Reply dikunci sampai ada kanal resmi                                       | ✅                                                                          |
| Mode simulasi berlabel untuk development                                                      | ✅                                                                          |

### Hasil verifikasi Fase 3

| Pemeriksaan                    | Hasil                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | bersih / lulus                                                                                                                                                                                      |
| Unit test `@smge/shared`       | 43/43 lulus (termasuk guardrail: pola terlarang & kalimat wajar yang tidak boleh ikut terblokir)                                                                                                    |
| Unit test API                  | 19/19 lulus                                                                                                                                                                                         |
| Integration test API           | 66/66 lulus — pipeline AI diuji dengan provider palsu: konteks KB, biaya, guardrail, kegagalan provider, batas biaya, minimisasi data kontak, izin role, mode tanpa provider                        |
| `next build` dashboard         | lulus (18 route)                                                                                                                                                                                    |
| Uji browser (mode simulasi)    | asisten tanya jawab & saran balasan, editor KB (peringatan klaim), penggunaan & biaya, pengaturan, analisis AI di detail prospek, draft AI di tugas outbound (draft simulasi tidak bisa diterapkan) |

### Untuk mengaktifkan AI

1. Isi `OPENAI_API_KEY` (dan `OPENAI_MODEL` sesuai model yang tersedia di akun) di `.env` server, lalu restart API.
2. Super Admin: **AI Sales Agent → Pengaturan AI** — isi harga model dari halaman harga resmi OpenAI dan batas biaya bulanan.
3. Admin: isi **Knowledge Base** dengan materi resmi Solid Mini lalu publikasikan.
4. Coba di tab **Asisten** sebelum dipakai operator.

### Keterbatasan Fase 3

- Belum pernah diuji terhadap API OpenAI sungguhan; hanya provider palsu (test) dan simulasi.
- Pemilihan dokumen KB memakai pencocokan kata kunci sederhana; untuk KB besar perlu retrieval berbasis embedding.
- Ringkasan memakai riwayat aktivitas prospek; ringkasan percakapan per thread menyusul bersama inbox (Fase 4).
- Auto-Reply belum dapat diaktifkan (menunggu integrasi messaging resmi).

## Fase 4 — Integrasi TikTok ✅ sebagian (16 Oktober 2026) — menunggu kredensial & akses TikTok

| Item                                                                      | Status                                                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Verifikasi dokumentasi resmi                                              | ✅ Login Kit, token, user info, webhook. ⚠️ Business API, Lead Gen, Messaging: dokumentasi resmi tidak dapat dibaca/diverifikasi |
| OAuth Login Kit resmi (authorize v2, tukar code, refresh, revoke)         | ✅ kode siap; **belum diuji ke TikTok sungguhan** (belum ada client key)                                                         |
| Sinkron profil: followers (ACTUAL), status verifikasi, avatar, nama       | ✅                                                                                                                               |
| Token terenkripsi, refresh otomatis, status kedaluwarsa/dicabut           | ✅                                                                                                                               |
| Retry + backoff, idempotensi (state OAuth sekali pakai, webhook duplikat) | ✅                                                                                                                               |
| Webhook dengan verifikasi signature; `authorization.removed`              | ✅                                                                                                                               |
| Halaman Integrasi: status kemampuan, URL konfigurasi, koneksi akun, log   | ✅                                                                                                                               |
| Mock Adapter berlabel SIMULASI (ditolak di produksi)                      | ✅                                                                                                                               |
| Worker: sinkron akun tiap 6 jam                                           | ✅                                                                                                                               |
| Business API (Ads Reporting)                                              | ❌ belum — menunggu dokumentasi resmi & akses                                                                                    |
| Lead Generation                                                           | ❌ belum — sementara: export CSV Ads Manager → Import CSV                                                                        |
| Messaging / Inbox Percakapan / Auto-reply                                 | ❌ belum — menunggu akses & dokumentasi resmi                                                                                    |

### Hasil verifikasi Fase 4

| Pemeriksaan                    | Hasil                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | bersih / lulus                                                                                                                                                                                                                               |
| Unit test API                  | 28/28 — termasuk adapter resmi diuji dengan `fetch` palsu: URL, metode, header, parameter persis sesuai dokumentasi; retry; signature webhook                                                                                                |
| Integration test API           | 73/73 — OAuth resmi (server TikTok palsu) & Mock, penolakan akun berbeda/scope kurang, state sekali pakai, refresh token, TOKEN_EXPIRED, putus koneksi, webhook (signature salah/kedaluwarsa, duplikat, pencabutan), token tidak bocor, RBAC |
| `next build` dashboard         | lulus (19 route)                                                                                                                                                                                                                             |
| Uji browser (Mock)             | hubungkan simulasi → persetujuan → kembali terhubung → sinkron; akun berbeda ditolak dengan pesan jelas                                                                                                                                      |

### Untuk mengaktifkan integrasi resmi

1. Buat aplikasi di **developers.tiktok.com**, tambahkan produk **Login Kit**, ajukan scope
   `user.info.basic`, `user.info.profile`, `user.info.stats`, dan tunggu persetujuan TikTok.
2. Daftarkan **Redirect URI** `https://<domain>/api/integrations/tiktok/callback` (wajib https — untuk uji lokal
   gunakan tunnel https, mis. ngrok yang tersedia di Laragon).
3. Atur **Webhook Callback URL** `https://<domain>/api/webhooks/tiktok`.
4. Isi `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` di `.env`, restart API & worker.
5. Admin membuka **Integrasi → Hubungkan**; pemilik tiap akun login di TikTok dan menyetujui.

### Keterbatasan Fase 4

- Belum pernah diuji terhadap TikTok sungguhan.
- `follower_count` hanya terisi bila scope `user.info.stats` disetujui; bila tidak, angka followers tetap input manual.
- Business API, Lead Generation, dan Messaging belum ada (lihat tabel di atas); halaman Percakapan masih placeholder.

## Fase 5 — Analitik ✅ (19 Oktober 2026) — menunggu integrasi dari backend Solid Mini

| Item                                                                                                                         | Status                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Link tracking per campaign/akun (link pendek, UTM otomatis, `smge_ref`, ID pengunjung, dedup klik, filter bot)               | ✅                                                         |
| Event landing page (kunjungan, klik CTA, klik store) — tidak terverifikasi                                                   | ✅                                                         |
| Conversion API server-to-server (HMAC + timestamp, idempoten): instal, registrasi, aktivasi, transaksi — terverifikasi       | ✅ kode siap; **menunggu backend Solid Mini memanggilnya** |
| Pencocokan prospek & pembaruan status terverifikasi                                                                          | ✅                                                         |
| Atribusi first-touch & last-touch                                                                                            | ✅                                                         |
| Dashboard analitik: KPI, funnel, Jalur A vs B, pertumbuhan prospek, status, campaign (CPL/CPR/CPA), akun, operator, biaya AI | ✅                                                         |
| Pemisahan data terverifikasi / konfirmasi operator / simulasi                                                                | ✅                                                         |
| Spesifikasi untuk tim Solid Mini ([CONVERSION-API.md](CONVERSION-API.md))                                                    | ✅                                                         |

### Hasil verifikasi Fase 5

| Pemeriksaan                    | Hasil                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | bersih / lulus                                                                                                                                                                                        |
| Unit test                      | shared 43/43, API 34/34 (atribusi, metrik biaya, signature Conversion API, kode link)                                                                                                                 |
| Integration test API           | 79/79 — redirect & UTM, dedup klik, bot, link nonaktif, event publik, HMAC (salah/kedaluwarsa), registrasi → prospek + atribusi first/last-touch, idempotensi, aktivasi, angka laporan & filter, RBAC |
| `next build` dashboard         | lulus (19 route)                                                                                                                                                                                      |
| Uji browser end-to-end         | buat link lewat UI → 3 pengunjung anonim klik → 2 registrasi + 1 aktivasi dikirim dengan HMAC → Analitik (konversi 66,7%, Rp250.000/registrasi), detail campaign, dashboard tampil benar              |

### Untuk mengaktifkan

1. Isi `CONVERSION_API_SECRET` (≥ 32 karakter acak) di `.env` SMGE dan bagikan ke tim backend Solid Mini lewat kanal aman.
2. Tim Solid Mini mengikuti [CONVERSION-API.md](CONVERSION-API.md): simpan `smge_ref` & `smge_vid` saat registrasi,
   kirim event `REGISTRATION`/`ACTIVATION` ke `POST /api/conversions`.
3. (Opsional) Daftarkan domain landing page di `TRACKING_ALLOWED_ORIGINS` dan pasang skrip event.
4. Buat link tracking di tiap campaign, lalu pakai link pendeknya di bio, video, atau DM.

### Keterbatasan Fase 5

- Belum diuji dengan backend Solid Mini sungguhan (diuji dengan request bertanda tangan buatan sendiri).
- Biaya campaign masih total input manual (bukan per hari); biaya iklan otomatis menunggu Ads Reporting resmi (Fase 4).
- Laporan dihitung langsung dari database tiap kali dibuka; untuk volume sangat besar perlu tabel agregat/cache.
- Instalasi hanya tercatat bila backend/MMP mengirim `INSTALL_VERIFIED`.

## Fase 6 — Produksi ✅ (19 Oktober 2026, belum diuji di VPS)

| Item                                                                                                                             | Status                                          |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Dockerfile multi-stage (target `api` untuk API/worker/migrasi, `dashboard` Next.js standalone), user non-root, healthcheck       | ✅ ditulis, **belum dijalankan**                |
| `docker-compose.prod.yml`: postgres, redis (password), migrate, api, worker, dashboard, nginx, certbot; hanya Nginx membuka port | ✅ divalidasi strukturnya, **belum dijalankan** |
| Nginx: HTTP→HTTPS, TLS 1.2/1.3, HSTS & header keamanan tunggal, rate limit login & endpoint publik, gzip, batas upload           | ✅ diuji berjalan                               |
| SSL Let's Encrypt (sertifikat awal + perpanjangan otomatis)                                                                      | ✅ ditulis, butuh domain nyata                  |
| Skrip operasional `smge.sh`: init-ssl, up, down, update, status, logs, backup, restore, reload-nginx                             | ✅                                              |
| Backup PostgreSQL (pg_dump format custom, retensi, chmod 600), rotasi log container                                              | ✅ ditulis                                      |
| Guard konfigurasi produksi: tolak secret contoh, URL non-https, CORS localhost, cookie tidak secure, mode simulasi               | ✅ diuji                                        |
| Audit dependensi: 6 temuan transitif diperbaiki lewat `pnpm.overrides`                                                           | ✅                                              |
| Panduan [DEPLOYMENT.md](DEPLOYMENT.md) dari server Ubuntu kosong                                                                 | ✅                                              |

### Hasil verifikasi Fase 6

| Pemeriksaan                                            | Hasil                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx -t` (Nginx 1.22 lokal + sertifikat self-signed) | ✅ OK                                                                                                                                                                           |
| Uji Nginx di depan API & dashboard lokal               | ✅ 301 ke HTTPS (ACME dikecualikan), health 200, dashboard 200, header keamanan tidak ganda, gzip aktif, login → 429 setelah batas, body 7 MB → 413, IP klien tercatat di audit |
| Guard produksi (`env.spec.ts` + boot manual)           | ✅ konfigurasi dev & mode mock ditolak; konfigurasi benar boot dengan cookie `HttpOnly; Secure`                                                                                 |
| `pnpm audit --prod`                                    | ✅ No known vulnerabilities found                                                                                                                                               |
| Lint, typecheck, build                                 | ✅                                                                                                                                                                              |
| Test: shared 43, API unit 37, e2e 79                   | ✅ semua lulus                                                                                                                                                                  |
| `docker build` / `docker compose up`                   | ⏳ **belum** — Docker tidak tersedia di mesin pengembangan                                                                                                                      |

### Keterbatasan Fase 6

- Image & Compose produksi belum pernah dijalankan; deployment pertama di VPS sekaligus uji integrasi
  (lihat checklist di DEPLOYMENT.md bagian 8).
- Backup offsite, monitoring/alerting uptime, dan staging belum disediakan — perlu dipilih sesuai infrastruktur.
- Rollback migrasi database tidak otomatis; mengandalkan backup yang dibuat sebelum `update`.

## Menunggu pihak lain

- OpenAI API key & materi Knowledge Base resmi Solid Mini.
- Kredensial TikTok Login Kit (client key/secret, redirect URI https).
- `CONVERSION_API_SECRET` & integrasi oleh tim backend/landing page Solid Mini.
- VPS & domain untuk deployment pertama.
