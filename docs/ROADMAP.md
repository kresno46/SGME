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
- **Redis** baru dipakai untuk health check; antrean BullMQ mulai Fase 2/3.
- **`next build` output standalone** (untuk image Docker) diaktifkan dengan `NEXT_OUTPUT=standalone`; di Windows
  membutuhkan hak membuat symlink, jadi di sana dimatikan secara default.
- **Unit test komponen dashboard** belum ada; dashboard divalidasi lewat typecheck, lint, build, dan uji manual.
- Halaman Campaign, CRM, Outbound, AI Sales, Percakapan, Analitik, dan Integrasi masih berupa placeholder
  yang menampilkan rencana fiturnya.

## Fase 2 — CRM & Campaign (berikutnya)

- Modul `campaigns` (CRUD, penugasan akun & operator, link tracking unik, filter/pagination).
- Modul `leads`: CRUD, deduplikasi, consent per kanal, daftar larangan kontak, import CSV (dengan pratinjau
  duplikat), export sesuai permission, segmentasi, riwayat aktivitas.
- Outbound Workstation: antrean per akun dari prospek yang memenuhi syarat (consent & bukan DNC), template,
  alur `DRAFT → WAITING_REVIEW → APPROVED → MANUALLY_SENT → …`, pengingat follow-up.
- BullMQ worker: pengingat follow-up, job retensi data. **Tidak ada** worker pengirim DM.

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
