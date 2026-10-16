# Solid Mini Growth Engine (SMGE)

Platform terpusat untuk pemasaran Solid Mini melalui beberapa akun TikTok: manajemen akun, campaign,
CRM prospek, Outbound Workstation, AI Sales Agent, inbox percakapan, dan tracking konversi.
Platform ini memakai dua jalur:

- **Jalur A — Official**: akun utama/terverifikasi, konten, LIVE, Messaging Ads, dan auto-reply resmi.
- **Jalur B — Outbound**: akun tambahan dengan penjangkauan personal yang ditinjau operator.
  Sistem **tidak** mengirim DM massal, tidak melakukan scraping, dan tidak memakai rotasi akun.

> **Status: Fase 1 (Fondasi) dan Fase 2 (CRM & Campaign) selesai.** Lihat [docs/ROADMAP.md](docs/ROADMAP.md) untuk status tiap fase
> dan keterbatasan yang diketahui.

## Teknologi

| Lapisan   | Teknologi                                                                 |
| --------- | ------------------------------------------------------------------------- |
| Dashboard | Next.js 15 (App Router), TypeScript, Tailwind CSS 4, komponen gaya shadcn/ui, TanStack Query, React Hook Form, Zod, Recharts |
| API       | NestJS 11, REST, Prisma 6, Argon2id, JWT + refresh token berotasi, RBAC  |
| Data      | PostgreSQL (14+), Redis + BullMQ (worker retensi data)                    |
| Monorepo  | pnpm workspaces                                                           |

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

| Role               | Ringkasan akses                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| Super Admin        | Semua fitur termasuk pengaturan sistem                                  |
| Admin              | Kelola pengguna (di bawah Admin), akun, campaign, integrasi, knowledge base |
| Marketing Operator | Prospek, Outbound Workstation, percakapan, AI copilot                   |
| Viewer             | Hanya melihat                                                           |

Detail permission: [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts).

## Dokumentasi

- [docs/ARSITEKTUR.md](docs/ARSITEKTUR.md): arsitektur, alur autentikasi, dan keamanan
- [docs/DATABASE.md](docs/DATABASE.md): rancangan database, deduplikasi, dan retensi
- [docs/API.md](docs/API.md): referensi endpoint REST
- [docs/ROADMAP.md](docs/ROADMAP.md): status fase, keterbatasan, dan langkah berikutnya
