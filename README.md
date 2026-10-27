# Solid Mini Growth Engine (SMGE)

Platform terpusat untuk pemasaran Solid Mini melalui beberapa akun TikTok: manajemen akun, campaign,
CRM prospek, Outbound Workstation, AI Sales Agent, inbox percakapan, dan tracking konversi.
Platform ini memakai dua jalur:

- **Jalur A — Official**: akun utama/terverifikasi, konten, LIVE, Messaging Ads, dan auto-reply resmi.
- **Jalur B — Outbound**: akun tambahan dengan penjangkauan personal yang ditinjau operator.
  Pengiriman tugas DM yang disetujui melalui extension browser tersedia sebagai versi awal;
  lihat [panduan DM browser](docs/BROWSER-DM.md). Pengambilan daftar followers yang tampil melalui extension browser
  tersedia dengan ekspor JSON dan import ke CRM; lihat [panduan collector](docs/FOLLOWER-COLLECTOR.md).
  Tidak memakai rotasi akun.

> **Status: Fase 1–3 & 5 selesai; Fase 4 (integrasi TikTok Login Kit) siap menunggu kredensial.** AI aktif setelah
> `OPENAI_API_KEY` diisi; koneksi TikTok resmi aktif setelah `TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI` diisi. Lihat [docs/ROADMAP.md](docs/ROADMAP.md) untuk status tiap fase
> dan keterbatasan yang diketahui.

## Teknologi

| Lapisan   | Teknologi                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Next.js 15 (App Router), TypeScript, Tailwind CSS 4, komponen gaya shadcn/ui, TanStack Query, React Hook Form, Zod, Recharts |
| API       | NestJS 11, REST, Prisma 6, Argon2id, JWT + refresh token berotasi, RBAC                                                      |
| Data      | PostgreSQL (14+), Redis + BullMQ (worker retensi data)                                                                       |
| Monorepo  | pnpm workspaces                                                                                                              |

## Struktur

```text
apps/
  api/          NestJS — src/{auth,users,audit,accounts,campaigns,leads,outbound,templates,
                retention,analytics,health,common,config,prisma} + src/worker.ts (BullMQ)
  dashboard/    Next.js — app/, components/, features/, hooks/, lib/
packages/
  database/     Skema Prisma, migrasi, seed
  shared/       Enum, label bahasa Indonesia, permission RBAC, skema Zod (dipakai API & dashboard)
  types/        Tipe DTO respons API
infrastructure/ docker/ (init DB), scripts/ (utilitas)
docs/           Dokumentasi arsitektur, database, API, roadmap
```

## Menjalankan secara lokal

Prasyarat: **Node.js ≥ 20.11**, **pnpm 10**, **PostgreSQL ≥ 14**, **Redis ≥ 6.2** (dibutuhkan worker; API tetap berjalan tanpa Redis).

### 1. Siapkan PostgreSQL & Redis

Pilih salah satu:

- **Laragon / instalasi lokal**: pastikan PostgreSQL berjalan, lalu buat dua database:
  ```bash
  psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE smge_dev;" -c "CREATE DATABASE smge_test;"
  ```
- **Docker**: `docker compose up -d` (membuat `smge_dev` dan `smge_test`, port hanya di 127.0.0.1).

### 2. Konfigurasi environment

```bash
cp .env.example .env
node infrastructure/scripts/generate-secrets.mjs   # salin hasilnya ke .env
```

Sesuaikan `DATABASE_URL`, `DATABASE_URL_TEST`, dan `SEED_SUPERADMIN_PASSWORD`.

### 3. Install, migrasi, seed

```bash
pnpm install
pnpm build:packages          # build @smge/types, @smge/shared, @smge/database (+ prisma generate)
pnpm db:migrate              # menerapkan migrasi ke smge_dev
pnpm db:seed                 # role, Super Admin awal, pengaturan default, template awal
                             # (jalankan ulang setelah upgrade agar permission role baru masuk)
# Opsional — tambahkan 3 akun TikTok demo berlabel SIMULASI:
#   SEED_DEMO_DATA=true pnpm db:seed
```

### 4. Jalankan

```bash
pnpm dev:api          # http://localhost:4000/api   (health: /api/health)
pnpm dev:dashboard    # http://localhost:3000
pnpm --filter @smge/api worker:dev   # opsional: worker BullMQ (retensi data harian 02.00 WIB)
```

Isi `SOLID_MINI_REGISTRATION_URL` di `.env` agar placeholder `{{link}}` pada template pesan berisi link
registrasi Solid Mini (UTM ditambahkan otomatis). Bila kosong, placeholder tersebut dikosongkan.

**AI Sales Agent**: isi `OPENAI_API_KEY` (dan `OPENAI_MODEL`) di `.env` lalu restart API. Tanpa key, AI tampil
"belum dikonfigurasi" dan fitur lain tetap berjalan. Untuk mencoba UI tanpa key, jalankan API dengan
`AI_PROVIDER=simulated` — semua keluaran berlabel SIMULASI. Langkah aktivasi lengkap: [docs/ROADMAP.md](docs/ROADMAP.md).

**Integrasi TikTok**: isi `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, dan `TIKTOK_REDIRECT_URI` (https, terdaftar di
developers.tiktok.com). Untuk mencoba alur tanpa kredensial, set `TIKTOK_USE_MOCK=true` (development saja; data
berlabel SIMULASI). Langkah lengkap: [docs/ROADMAP.md](docs/ROADMAP.md).

Login memakai `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`, lalu **segera ganti password**
dan aktifkan 2FA di **Pengaturan → Profil & keamanan**.

Dashboard memanggil API lewat proxy same-origin `/api/*` (rewrite Next.js ke `API_INTERNAL_URL`), sehingga
cookie sesi tetap httpOnly dan tidak perlu CORS di browser.

## Perintah kualitas

```bash
pnpm lint          # ESLint seluruh monorepo
pnpm typecheck     # TypeScript semua package
pnpm test          # unit test (shared: Vitest, API: Jest)
pnpm test:e2e      # integration test API terhadap DATABASE_URL_TEST (database di-reset!)
pnpm build         # build produksi semua package & aplikasi
```

## Akun & role

| Role               | Ringkasan akses                                                             |
| ------------------ | --------------------------------------------------------------------------- |
| Super Admin        | Semua fitur termasuk pengaturan sistem                                      |
| Admin              | Dashboard, akun, dan outreach milik sendiri; dapat menambah Marketing Operator/Viewer lewat Pengaturan → Pengguna |
| Marketing Operator | Dashboard, akun TikTok sendiri, pengambilan followers, DM, follow-up, dan template pribadi melalui Outbound |
| Viewer             | Hanya melihat                                                               |

Detail permission: [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts).

Menu CRM / Prospek dan AI Sales Agent saat ini hanya dibuka untuk Super Admin. Menu Jalur A
disembunyikan. Panduan kerja Marketing yang mengikuti tampilan saat ini tersedia di
[Panduan pengguna Marketing](docs/PANDUAN-MARKETING.md).

## Produksi

Deployment memakai Docker Compose + Nginx + Let's Encrypt di VPS Ubuntu:

```bash
cp .env.production.example .env.production   # isi semua secret, chmod 600
./infrastructure/scripts/smge.sh init-ssl     # sertifikat pertama
./infrastructure/scripts/smge.sh up           # build & jalankan
```

Panduan lengkap (hardening server, backup, update, rollback): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Dokumentasi

- [Panduan pengguna Marketing](docs/PANDUAN-MARKETING.md): cara login, mengambil followers, mengirim DM, follow-up, dan mengelola template pribadi
- [docs/ARSITEKTUR.md](docs/ARSITEKTUR.md): arsitektur, alur autentikasi, dan keamanan
- [docs/DATABASE.md](docs/DATABASE.md): rancangan database, deduplikasi, dan retensi
- [docs/API.md](docs/API.md): referensi endpoint REST
- [docs/ROADMAP.md](docs/ROADMAP.md): status fase, keterbatasan, dan langkah berikutnya
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deployment produksi di VPS Ubuntu
- [docs/CONVERSION-API.md](docs/CONVERSION-API.md): spesifikasi tracking untuk tim landing page & backend Solid Mini
