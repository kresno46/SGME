# Arsitektur & Keamanan

## Gambaran umum

```text
Browser ──HTTPS──▶ Nginx (Fase 6)
                     ├─ /        ▶ Next.js dashboard (:3000)
                     └─ /api/*   ▶ NestJS API (:4000) ──▶ PostgreSQL
                                                      └──▶ Redis / BullMQ worker (Fase 2+)
```

Di development, Next.js meneruskan `/api/*` ke API melalui `rewrites` sehingga browser hanya berbicara
dengan satu origin. Di produksi, Nginx meneruskan `/api` langsung ke API.

PostgreSQL dan Redis tidak pernah diekspos ke internet; di `docker-compose.yml` port hanya di-bind ke `127.0.0.1`.

## Monorepo

| Package          | Peran                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `@smge/shared`   | Satu sumber kebenaran untuk enum, label bahasa Indonesia, permission, dan skema Zod. Validasi form di dashboard dan validasi request di API memakai skema yang sama. |
| `@smge/types`    | Bentuk DTO respons API.                                                                 |
| `@smge/database` | Skema Prisma, migrasi, seed; mengekspor `PrismaClient`.                                 |
| `@smge/api`      | Modul NestJS per fitur (`auth`, `users`, `audit`, `accounts`, `analytics`, `health`). Modul fase berikutnya (`campaigns`, `leads`, `outbound`, `ai-sales`, `conversations`, `integrations`) ditambahkan dengan pola yang sama. |
| `@smge/dashboard`| Next.js App Router. `features/<modul>` berisi UI + hook data per fitur.                 |

## Autentikasi

1. `POST /api/auth/login` memverifikasi password (Argon2id). Bila 2FA aktif, respons berisi `challengeToken`
   (JWT 5 menit), lalu `POST /api/auth/2fa/verify` memverifikasi kode TOTP.
2. Login berhasil membuat baris `user_sessions` dan menyetel tiga cookie:
   - `smge_at`: access token JWT (HS256, 15 menit), **httpOnly**
   - `smge_rt`: refresh token acak 256-bit, **httpOnly**; yang disimpan di DB hanya hash SHA-256-nya
   - `smge_csrf`: token CSRF (dapat dibaca JS) untuk pola *double-submit*
3. Setiap request, `JwtAuthGuard` memverifikasi JWT **dan** memeriksa sesi di DB (belum dicabut, belum
   kedaluwarsa, pengguna aktif). Logout, ganti password, atau penonaktifan pengguna berlaku seketika.
4. `POST /api/auth/refresh` merotasi refresh token. Token lama yang dipakai ulang di luar jendela toleransi
   multi-tab (30 detik) dianggap pencurian, sehingga **semua sesi pengguna dicabut** dan kejadiannya dicatat di audit log.
5. Klien non-browser boleh memakai header `Authorization: Bearer <access token>`, yang tidak memerlukan CSRF.

Urutan guard global: **Throttler → JwtAuth → CSRF → Permissions (RBAC)**.

## Kontrol keamanan yang diterapkan (Fase 1)

| Kontrol | Implementasi |
| --- | --- |
| Hash password | Argon2id (`@node-rs/argon2`); verifikasi dummy untuk email tak dikenal agar waktu respons tidak membocorkan keberadaan akun |
| Kebijakan password | ≥10 karakter, huruf besar, huruf kecil, angka (skema Zod bersama) |
| Penguncian login | `LOGIN_MAX_ATTEMPTS` gagal berturut-turut → akun dikunci `LOGIN_LOCK_MINUTES` (HTTP 423); kode 2FA salah ikut dihitung |
| Rate limiting | Global `THROTTLE_LIMIT_PER_MINUTE` per IP; endpoint auth `THROTTLE_AUTH_LIMIT_PER_MINUTE` |
| CSRF | Double-submit cookie + header `X-CSRF-Token`, perbandingan *timing-safe* |
| RBAC | Permission per role disimpan di tabel `roles`; pengguna hanya bisa mengelola role di bawahnya |
| 2FA | TOTP (RFC 6238); secret dienkripsi AES-256-GCM |
| Enkripsi at-rest | `CryptoService` AES-256-GCM (`ENCRYPTION_KEY`) untuk token integrasi & secret 2FA |
| Reset password | Token acak sekali pakai (hash di DB), berlaku 30 menit, mencabut semua sesi |
| Audit log | Login/gagal/kunci, perubahan pengguna, akun TikTok, dll. Field sensitif disensor otomatis |
| Header keamanan | Helmet (API); X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (dashboard) |
| SQL injection | Hanya Prisma query builder; satu-satunya raw SQL (`TRUNCATE` di test) memakai nama tabel dari katalog |
| Secret | Semua dari environment, divalidasi saat start (`apps/api/src/config/env.ts`); produksi menolak `COOKIE_SECURE=false` |
| Data ke frontend | Token integrasi tidak pernah di-`select`; DTO eksplisit |
| Open redirect | Parameter `?next=` di login hanya menerima path internal |

## Prinsip data: aktual vs manual vs simulasi

Setiap angka yang bisa berasal dari sumber berbeda memiliki kolom `DataSource` (`ACTUAL`, `MANUAL`, `SIMULATED`):

- Followers yang diketik operator → `MANUAL`; hasil sinkron API resmi → `ACTUAL` (Fase 4).
- Data dari Mock Adapter / seed demo → `SIMULATED`, **tidak pernah** dijumlahkan ke total dan selalu tampil
  dengan label "Simulasi" serta batang bergaris di grafik.
- Metrik yang belum memiliki sumber (registrasi, aktivasi) dikirim sebagai `null` dan ditampilkan "—".

## Kepatuhan platform

- Password TikTok tidak pernah diminta; koneksi akun hanya lewat OAuth resmi (Fase 4).
- Tidak ada scraping followers, bot DM massal, bypass CAPTCHA, atau rotasi akun.
- Pengiriman otomatis hanya diaktifkan bila API resmi mengizinkan **dan** penerima memiliki persetujuan
  (`lead_consents`). Mengikuti akun ≠ persetujuan.
- Status "terkirim" pada tugas outbound hanya diisi setelah operator mengonfirmasi (`sent_confirmed_at`).

## Outbound Workstation (Jalur B) — aturan yang ditegakkan sistem

Aturan berada di `packages/shared/src/outbound.ts` (diuji unit) dan ditegakkan ulang oleh API pada setiap aksi:

1. **Kelayakan antrean**: bukan DNC, tidak ada di daftar larangan, status bukan `NOT_INTERESTED/REGISTERED/ACTIVE`,
   tidak punya tugas berjalan, dan punya kontak untuk kanal tersebut. Kanal selain DM TikTok **wajib** punya izin komunikasi.
2. **Review wajib**: `DRAFT → WAITING_REVIEW → APPROVED` sebelum bisa dikirim. Approve hanya oleh `outreach:review`
   (Admin/Super Admin).
3. **Pengiriman selalu manual**: sistem tidak mengirim DM. Status `MANUALLY_SENT` hanya diisi bila operator
   mengirim `confirmed: true`. Larangan kontak dan izin dicek ulang tepat saat konfirmasi.
4. **Follow-up dibatasi**: tanpa balasan hanya boleh bila prospek memberi izin untuk kanal tersebut, dan maksimal
   2 pesan tanpa balasan per tugas.
5. **Opt-out langsung berlaku**: balasan "stop" (`optOut`) menandai prospek DNC, mencabut izin, dan membatalkan tugas lain.
6. **Batas harian per akun** (`outbound.daily_task_limit_per_account`, default 30) — menjaga penjangkauan tetap personal.
   Ini batas yang dipilih sendiri, bukan cara menghindari pembatasan TikTok.
7. Akun yang statusnya bukan `ACTIVE` (dijeda/dibatasi) tidak dapat dipakai membuat tugas baru.

## Daftar larangan kontak

Entri disimpan per jenis identitas (username TikTok, email, telepon — telepon berlaku juga untuk WhatsApp & SMS)
dan berlaku untuk **semua kanal**. Invarian: setiap prospek yang cocok dengan entri memiliki `do_not_contact = true`
(ditegakkan saat prospek dibuat, saat import, dan saat entri ditambahkan). Daftar ini tidak dihapus oleh job retensi.

## Worker

`apps/api/src/worker.ts` (BullMQ) dijalankan terpisah dari API (`pnpm --filter @smge/api worker`). Saat ini hanya
menjalankan **retensi data harian pukul 02.00 WIB**. Tidak ada job pengirim pesan.
BullMQ merekomendasikan Redis ≥ 6.2 (Redis 5 di Laragon berfungsi dengan peringatan; `docker-compose.yml` memakai Redis 7).

## AI Sales Agent

```text
Fitur (tanya, saran balasan, draft, skor, ringkasan)
  └─ AiService.run()
       1. provider ada?                → 503 bila belum dikonfigurasi
       2. batas biaya bulanan          → 403 bila terlampaui (simulasi tidak dihitung)
       3. konteks KB (dokumen terbit, dipilih berdasar relevansi kata kunci, ≤ 12.000 karakter)
       4. LlmProvider.complete()        → OpenAI Chat Completions + Structured Outputs (JSON Schema strict)
       5. validasi Zod atas JSON        → 502 bila tidak sesuai
       6. guardrail klaim terlarang     → 422 + status BLOCKED (tidak dikembalikan ke operator)
       7. hitung biaya dari harga yang diatur admin, simpan ai_interactions (token, biaya, latensi)
```

- **Provider** (`apps/api/src/ai/providers`): `OpenAiProvider` (aktif bila `OPENAI_API_KEY` terisi),
  `SimulatedProvider` (hanya bila `AI_PROVIDER=simulated`; semua keluaran berlabel SIMULASI, `is_simulation=true`,
  tidak dihitung biaya, draft simulasi tidak dapat diterapkan ke tugas). Tanpa keduanya, AI nonaktif dan UI
  menampilkan "belum dikonfigurasi".
- **Mode Copilot**: AI hanya memberi saran; operator meninjau, menerapkan, dan mengirim sendiri. Mode Auto-Reply
  ditolak oleh API sampai ada integrasi messaging resmi yang mengizinkan (Fase 4).
- **Instruksi sistem** (`prompts.ts`): fakta produk hanya dari Knowledge Base; dilarang menjanjikan keuntungan,
  imbal hasil, atau "tanpa risiko"; dilarang memberi nasihat keuangan atau meminta data sensitif; bahasa Indonesia
  natural; hormati penolakan; data dari prospek/KB dibungkus penanda dan tidak dianggap instruksi
  (mitigasi prompt injection).
- **Handoff ke manusia**: model mengisi `handoff`/`handoffReason` untuk pertanyaan di luar KB, keluhan, permintaan
  nasihat keuangan, emosi negatif, atau permintaan bicara dengan manusia.
- **Guardrail kedua** (`packages/shared/src/ai-guardrails.ts`): pola klaim terlarang (janji profit, persentase
  imbal hasil per periode, "tanpa risiko", "cepat kaya", tekanan berlebihan) diperiksa pada keluaran AI di server dan
  ditampilkan sebagai peringatan langsung saat operator mengetik draft atau dokumen KB.
- **Minimisasi data**: konteks prospek yang dikirim ke penyedia AI hanya nama panggilan, status, ketertarikan,
  sumber, tag, kanal izin, dan riwayat aktivitas. Email, telepon, username TikTok, dan nama lengkap tidak dikirim.
- **Biaya**: harga per 1 juta token diisi admin dari halaman harga resmi penyedia (tidak di-hardcode). Tanpa harga,
  biaya tercatat US$0 dan UI menampilkan peringatan.
