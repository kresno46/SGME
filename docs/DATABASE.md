# Rancangan Database

Sumber: [packages/database/prisma/schema.prisma](../packages/database/prisma/schema.prisma).
Seluruh 19 tabel yang diminta, ditambah 6 tabel pendukung, sudah dibuat sejak migrasi awal agar fase
berikutnya tidak memerlukan perubahan struktur besar.

**Konvensi:** PK UUID, foreign key dengan aturan `onDelete` eksplisit, nama tabel/kolom `snake_case`,
`created_at`/`updated_at` di setiap tabel yang dapat berubah (tabel log bersifat append-only dan hanya punya
`created_at`), enum PostgreSQL untuk semua status.

## Daftar tabel

| # | Tabel | Fungsi | Dipakai sejak |
|---|---|---|---|
| 1 | `users` | Pengguna dashboard, status, lockout, 2FA | Fase 1 |
| 2 | `roles` | Role + daftar permission | Fase 1 |
| 3 | `tiktok_accounts` | Akun TikTok, jalur, followers + sumber datanya | Fase 1 |
| 4 | `account_integrations` | Koneksi API per akun; token terenkripsi; flag `is_simulation` | Fase 4 |
| 5 | `campaigns` | Campaign, anggaran, biaya, `tracking_code` unik | Fase 2 |
| 6 | `leads` | Prospek + kolom ternormalisasi untuk dedup | Fase 2 |
| 7 | `lead_consents` | Persetujuan komunikasi per kanal + bukti | Fase 2 |
| 8 | `lead_activities` | Riwayat interaksi prospek | Fase 2 |
| 9 | `conversations` | Percakapan per kanal resmi | Fase 4 |
| 10 | `messages` | Pesan; `idempotency_key` unik | Fase 4 |
| 11 | `message_templates` | Template DM dengan placeholder | Fase 2 |
| 12 | `outreach_tasks` | Antrean tugas Outbound Workstation | Fase 2 |
| 13 | `ai_interactions` | Log AI: token, biaya USD, latensi | Fase 3 |
| 14 | `knowledge_documents` | Knowledge Base Solid Mini (versi & status) | Fase 3 |
| 15 | `conversion_events` | Event funnel; `is_verified`, `idempotency_key` | Fase 5 |
| 16 | `campaign_attributions` | Atribusi first/last-touch per event | Fase 5 |
| 17 | `integration_logs` | Log request/webhook (payload disensor) | Fase 4 |
| 18 | `audit_logs` | Jejak audit (append-only) | Fase 1 |
| 19 | `system_settings` | Pengaturan key-value (retensi, mode AI) | Fase 1 |
| + | `user_sessions` | Sesi login & hash refresh token | Fase 1 |
| + | `password_reset_tokens` | Token reset (hash) | Fase 1 |
| + | `campaign_accounts` | Relasi many-to-many campaign ↔ akun | Fase 2 |
| + | `do_not_contact_entries` | Daftar larangan kontak (tetap ada walau prospek dihapus) | Fase 2 |
| + | `tracking_links` | Link unik per campaign/akun dengan UTM | Fase 5 |

## Deduplikasi prospek

`leads` menyimpan nilai mentah **dan** nilai ternormalisasi dengan constraint `UNIQUE`:

| Kolom | Normalisasi (`packages/shared/src/normalize.ts`) |
|---|---|
| `tiktok_username_normalized` | hapus `@`, huruf kecil |
| `email_normalized` | trim, huruf kecil |
| `phone_normalized` | format `62…` (0812… / +62812… / 812… → 62812…) |

Import dan input manual (Fase 2) mencari kecocokan pada ketiga kolom sebelum membuat prospek baru; bentrok
ditampilkan sebagai kandidat penggabungan (`lead_activities.type = MERGE`).

## Persetujuan & larangan kontak

- `lead_consents` unik per `(lead_id, channel)` dan menyimpan `source` + `evidence`.
- Outbound hanya menampilkan prospek yang belum `do_not_contact` dan tidak ada di `do_not_contact_entries`.
- Mengikuti akun TikTok **tidak** membuat baris consent.

## Retensi data

Nilai default ada di `system_settings` (di-seed):

| Key | Default | Tindakan (job BullMQ, Fase 2) |
|---|---|---|
| `retention.lead_inactive_days` | 730 | Anonimkan data pribadi prospek tak aktif (`anonymized_at`), simpan agregat |
| `retention.audit_log_days` | 1095 | Hapus audit log lebih tua |
| `retention.integration_log_days` | 180 | Hapus log integrasi lebih tua |

Kolom `leads.retention_until`, `anonymized_at`, `deleted_at` (soft delete) disiapkan untuk ini.

## Migrasi & seed

```bash
pnpm db:migrate          # development (membuat migrasi baru bila skema berubah)
pnpm db:deploy           # produksi (hanya menerapkan migrasi)
pnpm db:seed             # idempoten
```

Seed membuat 4 role dengan permission default, Super Admin dari `.env`, dan pengaturan default.
`SEED_DEMO_DATA=true` menambah 3 akun TikTok demo berlabel `SIMULATED`.
