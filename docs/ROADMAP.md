# Roadmap & Status

## Fase 1 — Fondasi ✅ (15 Oktober 2026)

| Item | Status |
|---|---|
| Monorepo pnpm, TypeScript, ESLint, Prettier | ✅ |
| Rancangan database lengkap (25 tabel) + migrasi awal + seed | ✅ |
| NestJS API: konfigurasi tervalidasi, Prisma, filter error berbahasa Indonesia | ✅ |
| Autentikasi: Argon2id, JWT + refresh token berotasi, deteksi reuse, CSRF, lockout, rate limit | ✅ |
| 2FA TOTP, reset password (email/SMTP opsional), ganti password, manajemen sesi | ✅ |
| RBAC 4 role + manajemen pengguna + log audit | ✅ |
| Manajemen akun TikTok (CRUD, filter, pagination, status integrasi, label sumber data) | ✅ |
| Health check (database + Redis) | ✅ |
| Dashboard Next.js: login + 2FA, layout 10 menu, dark/light mode, responsif, ringkasan + grafik, akun TikTok, pengaturan | ✅ |
| `docker-compose.yml` untuk PostgreSQL + Redis (development) | ✅ ditulis, **belum dijalankan** (Docker tidak tersedia di mesin pengembangan) |

### Hasil verifikasi Fase 1

| Pemeriksaan | Hasil |
|---|---|
| `pnpm lint` | 0 error, 0 warning |
| `pnpm typecheck` | lulus (semua package) |
| Unit test `@smge/shared` (Vitest) | 12/12 lulus |
| Unit test API (Jest) | 16/16 lulus |
| Integration test API (Jest + Supertest + PostgreSQL `smge_test`) | 25/25 lulus |
| `next build` dashboard | lulus (17 route) |
| Uji manual via browser (Edge, light/dark, desktop/mobile) | login, dashboard, akun TikTok, form validasi, pengguna tampil benar |

### Keterbatasan yang diketahui

- **Email:** tanpa `SMTP_HOST`, link reset password hanya ditulis ke log server. Produksi wajib mengisi SMTP.
- **Rate limit** disimpan di memori proses API. Untuk lebih dari satu instance API, pindahkan storage
  throttler ke Redis (direncanakan bersama BullMQ).
- **`next build` output standalone** (untuk image Docker) diaktifkan dengan `NEXT_OUTPUT=standalone`; di Windows
  membutuhkan hak membuat symlink, jadi di sana dimatikan secara default.
- **Unit test komponen dashboard** belum ada; dashboard divalidasi lewat typecheck, lint, build, dan uji manual.
## Fase 2 — CRM & Campaign ✅ (16 Oktober 2026)

| Item | Status |
|---|---|
| Campaign: CRUD, 7 jenis & 6 status, akun sejalur, operator, kode tracking unik, anggaran & biaya manual, statistik + biaya per lead | ✅ |
| CRM prospek: CRUD, deduplikasi (username/email/telepon ternormalisasi), segmentasi (status, ketertarikan, sumber, akun, campaign, operator, izin, tag, follow-up) | ✅ |
| Izin komunikasi per kanal dengan bukti wajib; pencabutan membatalkan tugas terkait | ✅ |
| Daftar larangan kontak (DNC) lintas kanal, termasuk saat prospek dibuat & import | ✅ |
| Riwayat aktivitas (timeline) + catatan | ✅ |
| Import CSV (pratinjau, duplikat dalam file & database, DNC, pernyataan dasar hukum wajib) | ✅ |
| Export CSV/Excel sesuai permission, tercatat di audit | ✅ |
| Hapus data pribadi (anonimisasi) | ✅ |
| Template pesan dengan placeholder tervalidasi | ✅ |
| Outbound Workstation: antrean berprioritas (skor + alasan), review wajib, kirim **manual** dengan konfirmasi, catat balasan, follow-up terbatas, opt-out → DNC, batas harian per akun | ✅ |
| Worker BullMQ + kebijakan retensi data (dry-run & endpoint manual Super Admin) | ✅ |

### Hasil verifikasi Fase 2

| Pemeriksaan | Hasil |
|---|---|
| `pnpm lint` | 0 error, 0 warning |
| `pnpm typecheck` | lulus (semua package) |
| Unit test `@smge/shared` (Vitest) | 27/27 lulus |
| Unit test API (Jest) | 19/19 lulus |
| Integration test API (Jest + Supertest + PostgreSQL `smge_test`) | 54/54 lulus (7 suite) |
| `next build` dashboard | lulus (18 route) |
| Worker BullMQ terhadap Redis lokal | berjalan; jadwal retensi harian terdaftar |
| Uji alur di browser (Edge) | campaign, prospek (deteksi duplikat), detail & timeline, pratinjau import, outbound lengkap sampai kirim manual (tombol simpan nonaktif sebelum konfirmasi dicentang), template, mode gelap, mobile |

### Keterbatasan Fase 2

- **Registrasi masih konfirmasi manual operator** (`registeredAt` dari hasil tugas/ubah status). Verifikasi dari
  backend Solid Mini menyusul di Fase 5.
- **Antrean outbound** mengurutkan maksimal 500 kandidat terbaru per permintaan; untuk volume besar gunakan pencarian
  atau filter campaign. Skor prioritas masih berbasis aturan; skor AI menyusul di Fase 3.
- **Batas harian** dihitung per hari kalender WIB (`Asia/Jakarta`), terlepas dari zona waktu server.
- **Draft pesan belum dibuat AI** — memakai template (AI Message Generator di Fase 3).
- **Notifikasi follow-up** hanya berupa daftar "jatuh tempo" di dashboard; belum ada notifikasi email/push.
- Halaman AI Sales, Percakapan, Analitik, dan Integrasi masih berupa placeholder yang menampilkan rencana fiturnya.

## Fase 3 — AI Sales

OpenAI API (model dapat dikonfigurasi), Knowledge Base, generator pesan, lead scoring, saran balasan,
ringkasan percakapan, human handoff, pencatatan token & biaya (`ai_interactions`). Mode default: Copilot.

## Fase 4 — Integrasi TikTok

Verifikasi dokumentasi resmi TikTok (Login Kit, Business API, Lead Generation, Messaging) **sebelum**
implementasi; token terenkripsi, refresh otomatis, retry + idempotency, validasi signature webhook, log
integrasi. Mock Adapter berlabel SIMULASI untuk akses yang belum disetujui.

## Fase 5 — Analitik

Link tracking & UTM, endpoint conversion API untuk backend Solid Mini (HMAC), atribusi first/last-touch,
funnel, CPL/CPR/CPA, perbandingan jalur & akun, produktivitas operator, biaya AI.

## Fase 6 — Produksi

Dockerfile API, dashboard (standalone), dan worker; compose produksi; Nginx + SSL (Let's Encrypt); backup
PostgreSQL terjadwal; log rotation; panduan deployment VPS Ubuntu dari server kosong; uji keamanan.
