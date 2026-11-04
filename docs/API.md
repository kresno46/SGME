# Referensi API (Fase 1)

Base URL: `/api`. Semua respons berformat JSON.

**Autentikasi:** cookie sesi (dashboard) atau `Authorization: Bearer <access token>`.
**CSRF:** request `POST/PATCH/PUT/DELETE` berbasis cookie wajib menyertakan header `X-CSRF-Token` yang
sama dengan cookie `smge_csrf`.

**Format error**

```json
{ "statusCode": 400, "message": "Pesan utama", "errors": { "field": ["pesan per field"] } }
```

Kode umum: `400` validasi, `401` sesi tidak valid, `403` tidak berwenang / CSRF, `404`, `409` konflik
(duplikat), `423` akun terkunci, `429` rate limit.

**Pagination** (`GET` daftar): `page` (default 1), `pageSize` (default 20, maks 100), `search`.
Respons: `{ items, page, pageSize, total, totalPages }`.

## Health

| Method | Path      | Akses  | Keterangan                                                    |
| ------ | --------- | ------ | ------------------------------------------------------------- |
| GET    | `/health` | publik | Status database & Redis. `503` bila database tidak terjangkau |

## Auth

| Method | Path                    | Akses  | Body / keterangan                                                                                                    |
| ------ | ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`           | publik | `{ email, password }` → `{ status: "AUTHENTICATED", user }` atau `{ status: "TWO_FACTOR_REQUIRED", challengeToken }` |
| POST   | `/auth/2fa/verify`      | publik | `{ challengeToken, code }`                                                                                           |
| POST   | `/auth/refresh`         | cookie | Rotasi refresh token                                                                                                 |
| POST   | `/auth/logout`          | login  | Mencabut sesi saat ini                                                                                               |
| GET    | `/auth/me`              | login  | Profil + permission                                                                                                  |
| GET    | `/auth/sessions`        | login  | Daftar sesi aktif (`current` menandai sesi ini)                                                                      |
| DELETE | `/auth/sessions/:id`    | login  | Akhiri sesi lain milik sendiri                                                                                       |
| POST   | `/auth/change-password` | login  | `{ currentPassword, newPassword, confirmPassword }` — mencabut sesi lain                                             |
| POST   | `/auth/forgot-password` | publik | `{ email }` — respons selalu sama                                                                                    |
| POST   | `/auth/reset-password`  | publik | `{ token, password, confirmPassword }`                                                                               |
| POST   | `/auth/2fa/setup`       | login  | → `{ otpauthUrl, qrCodeDataUrl, secret }`                                                                            |
| POST   | `/auth/2fa/enable`      | login  | `{ code }`                                                                                                           |
| POST   | `/auth/2fa/disable`     | login  | `{ password, code }`                                                                                                 |

## Pengguna & role

| Method | Path                        | Permission     | Keterangan                                                                                                 |
| ------ | --------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/users`                    | `users:read`   | Filter `role`, `status`, `search`                                                                          |
| POST   | `/users`                    | `users:manage` | `{ name, email, role, password }` — hanya role di bawah aktor                                              |
| PATCH  | `/users/:id`                | `users:manage` | `{ name?, role?, status? }` — tidak bisa mengubah role/status diri sendiri; `DISABLED` mencabut semua sesi |
| POST   | `/users/:id/reset-password` | `users:manage` | `{ password }`                                                                                             |
| POST   | `/users/:id/unlock`         | `users:manage` | Buka kunci login                                                                                           |
| POST   | `/users/:id/reset-2fa`      | `users:manage` | Matikan 2FA pengguna                                                                                       |
| GET    | `/roles`                    | `roles:read`   | Role + permission + jumlah pengguna                                                                        |

## Audit

| Method | Path          | Permission   | Keterangan                                                  |
| ------ | ------------- | ------------ | ----------------------------------------------------------- |
| GET    | `/audit-logs` | `audit:read` | Filter `action` (prefix), `actorId`, `entityType`, `search` |

## Akun TikTok

| Method | Path                   | Permission        | Keterangan                                                                                                              |
| ------ | ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tiktok-accounts`     | `accounts:read`   | Filter `lane`, `status`, `search`; `sortBy` (`followersCount`/`createdAt`/`username`), `sortDir`                        |
| GET    | `/tiktok-accounts/:id` | `accounts:read`   | Termasuk status integrasi (tanpa token) dan statistik                                                                   |
| POST   | `/tiktok-accounts`     | `accounts:manage` | `{ username, displayName, lane, accountType?, isVerified?, followersCount?, status?, profileUrl?, avatarUrl?, notes? }` |
| PATCH  | `/tiktok-accounts/:id` | `accounts:manage` | Field parsial; perubahan followers → sumber `MANUAL`                                                                    |
| DELETE | `/tiktok-accounts/:id` | `accounts:manage` | `409` bila akun punya riwayat percakapan/tugas outbound (arsipkan saja)                                                 |

Username dinormalisasi (`@Solid.Mini` → `solid.mini`) dan unik.

## Analitik

| Method | Path                  | Permission       | Keterangan                                                                                                                                                    |
| ------ | --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/analytics/overview` | `dashboard:view` | Ringkasan akun, followers per sumber data, per jalur, top 10 akun, metrik CRM. Data `SIMULATED` tidak dijumlahkan; metrik yang belum tersedia bernilai `null` |

---

# Fase 2 — Campaign, CRM, Outbound

## Campaign

| Method | Path             | Permission         | Keterangan                                                                                                                                                                                                                   |
| ------ | ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns`     | `campaigns:read`   | Filter `lane`, `status` (default: semua kecuali `ARCHIVED`), `type`, `accountId`, `search`; `sortBy` `createdAt`/`startDate`/`name`                                                                                          |
| GET    | `/campaigns/:id` | `campaigns:read`   | Termasuk `stats` (prospek, tertarik, terdaftar, tugas outbound, biaya per lead)                                                                                                                                              |
| POST   | `/campaigns`     | `campaigns:manage` | `{ name, lane, type, status?, target?, description?, startDate?, endDate?, budget?, spend?, operatorId?, accountIds[] }` — akun harus sejalur; status `SCHEDULED`/`ACTIVE` wajib `startDate`; `trackingCode` dibuat otomatis |
| PATCH  | `/campaigns/:id` | `campaigns:manage` | Field parsial; `accountIds` mengganti seluruh penugasan; `spend` → sumber `MANUAL`                                                                                                                                           |
| DELETE | `/campaigns/:id` | `campaigns:manage` | `409` bila sudah ada prospek/tugas/event — arsipkan saja                                                                                                                                                                     |

## Prospek

| Method | Path                           | Permission     | Keterangan                                                                                                                                                                                                                                                  |
| ------ | ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/leads`                       | `leads:read`   | Segmentasi: `status` (boleh dipisah koma), `interestLevel`, `source`, `sourceAccountId`, `sourceCampaignId`, `operatorId` (`me`/`none`/UUID), `consentChannel`, `tag`, `followUp` (`due`/`scheduled`), `includeDoNotContact`, `search`, `sortBy`, `sortDir` |
| GET    | `/leads/:id`                   | `leads:read`   | Detail + izin, 100 aktivitas terakhir, 20 tugas terakhir, `onBlocklist`                                                                                                                                                                                     |
| GET    | `/leads/duplicates`            | `leads:read`   | `?tiktokUsername=&email=&phone=&excludeId=` → kandidat duplikat                                                                                                                                                                                             |
| POST   | `/leads`                       | `leads:manage` | Minimal satu kontak. `consents[]` = `{ channel, source, evidence }`. `409` + `details.duplicates` bila duplikat. Kontak yang ada di daftar larangan → prospek langsung `DO_NOT_CONTACT`                                                                     |
| PATCH  | `/leads/:id`                   | `leads:manage` | Field parsial + `status` (kecuali `DO_NOT_CONTACT`); perubahan tercatat di riwayat                                                                                                                                                                          |
| DELETE | `/leads/:id`                   | `leads:delete` | **Anonimisasi**: data pribadi, izin, dan riwayat dihapus; baris dipertahankan untuk statistik                                                                                                                                                               |
| POST   | `/leads/:id/notes`             | `leads:manage` | `{ note }`                                                                                                                                                                                                                                                  |
| POST   | `/leads/:id/consents`          | `leads:manage` | `{ channel, source, evidence }` (bukti wajib)                                                                                                                                                                                                               |
| POST   | `/leads/:id/consents/withdraw` | `leads:manage` | `{ channel, reason? }` — tugas kanal tsb yang belum terkirim dibatalkan                                                                                                                                                                                     |
| POST   | `/leads/:id/do-not-contact`    | `leads:manage` | `{ reason }` — izin dicabut, tugas terbuka dibatalkan, kontak masuk daftar larangan                                                                                                                                                                         |
| DELETE | `/leads/:id/do-not-contact`    | `dnc:manage`   | Cabut larangan (izin tidak dipulihkan otomatis)                                                                                                                                                                                                             |
| GET    | `/leads/export`                | `leads:export` | Filter sama dengan daftar + `format=csv\|xlsx`; maks. 50.000 baris; tercatat di audit                                                                                                                                                                       |
| POST   | `/leads/import/preview`        | `leads:import` | multipart `file` (CSV ≤ 5 MB, ≤ 5.000 baris) → jumlah baru/duplikat/diblokir/tidak valid + contoh                                                                                                                                                           |
| POST   | `/leads/import`                | `leads:import` | multipart `file` + `sourceDescription` (wajib), `lawfulBasisConfirmed=true` (wajib), `tags`, `sourceCampaignId`, `sourceAccountId`, `duplicateStrategy` (`skip`/`update_empty`)                                                                             |

Kolom CSV yang dikenali (header, tidak peka huruf besar): `nama/name`, `tiktok_username/tiktok/username`,
`email`, `phone/telepon/no_hp/whatsapp/wa`, `tags`, `catatan/notes`, `izin_whatsapp/consent_whatsapp`,
`izin_email/consent_email` (nilai `ya/yes/1/true`). Pemisah koma, titik koma, atau tab.

## Daftar larangan kontak

| Method | Path                  | Permission     | Keterangan                                                             |
| ------ | --------------------- | -------------- | ---------------------------------------------------------------------- |
| GET    | `/do-not-contact`     | `leads:read`   | Filter `channel`, `search`                                             |
| POST   | `/do-not-contact`     | `leads:manage` | `{ channel, value, reason? }` — semua prospek yang cocok ikut ditandai |
| DELETE | `/do-not-contact/:id` | `dnc:manage`   | Status prospek tidak berubah otomatis                                  |

## Template pesan

| Method            | Path                       | Permission         | Keterangan                                                                                                                                                                                   |
| ----------------- | -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET               | `/message-templates`       | `outreach:work`    | Filter `lane`, `purpose`, `activeOnly`                                                                                                                                                       |
| POST/PATCH/DELETE | `/message-templates[/:id]` | `templates:manage` | Placeholder: `{{nama}}`, `{{username}}`, `{{akun}}`, `{{campaign}}`, `{{link}}` (placeholder lain ditolak). `{{link}}` memakai `SOLID_MINI_REGISTRATION_URL` + UTM; kosong bila belum diatur |

## Outbound Workstation (hanya akun Jalur B)

Import hasil browser collector: `POST /outbound/followers/import`, izin `outreach:work` dan
`leads:import`. Body `{ accountId, batch }`, maksimal 250 baris format `smge-followers-v1`.
Respons menghitung `received`, `unique`, `duplicateRows`, `blocked`, `existing`, `self`, `created`.
Lihat [format file dan petunjuk collector](FOLLOWER-COLLECTOR.md). Sumber file tidak diverifikasi API TikTok;
import tidak memberi izin komunikasi dan tidak mengirim DM.

| Method | Path                           | Permission      | Keterangan                                                                                                                                                              |
| ------ | ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/outbound/summary/:accountId` | `outreach:work` | Jumlah per status, tugas hari ini vs batas harian, follow-up jatuh tempo, tingkat balasan 7 hari                                                                        |
| GET    | `/outbound/queue`              | `outreach:work` | `accountId` (wajib), `channel`, `campaignId`, `search` — prospek yang memenuhi syarat, diurutkan skor prioritas + alasannya (maks. 500 kandidat terbaru per permintaan) |
| GET    | `/outbound/tasks`              | `outreach:work` | Filter `accountId`, `status` (dipisah koma), `operatorId=me`, `followUpDue=true`, `leadId`                                                                              |
| GET    | `/outbound/tasks/:id`          | `outreach:work` | Termasuk `allowedActions` untuk pengguna saat ini                                                                                                                       |
| POST   | `/outbound/tasks`              | `outreach:work` | `{ leadId, tiktokAccountId, channel?, templateId?, campaignId?, draftMessage? }` — kelayakan & batas harian dicek ulang                                                 |
| PATCH  | `/outbound/tasks/:id/draft`    | `outreach:work` | `{ draftMessage }` (status `DRAFT` atau `FOLLOW_UP`)                                                                                                                    |
| POST   | `/outbound/tasks/:id/actions`  | per aksi        | Lihat tabel aksi di bawah                                                                                                                                               |

| Aksi (`action`)      | Dari status                                | Ke status      | Permission        | Body tambahan                                                                 |
| -------------------- | ------------------------------------------ | -------------- | ----------------- | ----------------------------------------------------------------------------- |
| `submit`             | DRAFT                                      | WAITING_REVIEW | `outreach:work`   | —                                                                             |
| `approve`            | WAITING_REVIEW                             | APPROVED       | `outreach:review` | `finalMessage?`                                                               |
| `reject`             | WAITING_REVIEW                             | DRAFT          | `outreach:review` | `reviewNote`                                                                  |
| `reopen`             | APPROVED                                   | DRAFT          | `outreach:work`   | —                                                                             |
| `mark_sent`          | APPROVED, FOLLOW_UP                        | MANUALLY_SENT  | `outreach:work`   | **`confirmed: true` wajib**, `message?`                                       |
| `log_reply`          | MANUALLY_SENT, FOLLOW_UP                   | REPLIED        | `outreach:work`   | `responseSummary`, `interestLevel`, `optOut?`                                 |
| `schedule_follow_up` | MANUALLY_SENT, REPLIED                     | FOLLOW_UP      | `outreach:work`   | `followUpAt` (masa depan), `draftMessage?`                                    |
| `complete`           | MANUALLY_SENT, REPLIED, FOLLOW_UP          | COMPLETED      | `outreach:work`   | `outcome` (`REGISTERED`/`INTERESTED`/`NOT_INTERESTED`/`NO_RESPONSE`), `note?` |
| `cancel`             | DRAFT, WAITING_REVIEW, APPROVED, FOLLOW_UP | CANCELLED      | `outreach:work`   | `reason`                                                                      |

## Lain-lain

| Method | Path                     | Permission        | Keterangan                                                           |
| ------ | ------------------------ | ----------------- | -------------------------------------------------------------------- |
| GET    | `/users/assignable`      | `leads:read`      | Pengguna aktif yang dapat ditugaskan (id, nama)                      |
| POST   | `/maintenance/retention` | `settings:manage` | `{ dryRun?: boolean }` (default `true`) — jalankan kebijakan retensi |

---

# Fase 3 — AI Sales Agent

Semua endpoint AI mengembalikan metadata hasil: `interactionId` (null bila model tidak dipanggil), `model`,
`simulated`, `usage { promptTokens, completionTokens, costUsd }` (costUsd `null` bila harga model belum diatur),
dan `sources` (dokumen KB yang dipakai).

Kode error khusus: `503` AI belum dikonfigurasi · `403` batas biaya bulanan tercapai · `422` jawaban diblokir
guardrail (`details.claims`) · `502` provider gagal / format jawaban tidak valid · `429` batas
`THROTTLE_AI_LIMIT_PER_MINUTE`.

## AI

| Method  | Path                    | Permission                 | Keterangan                                                                                                                                                                               |
| ------- | ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/ai/status`            | `ai:use`                   | Provider, model, mode, simulasi, jumlah dokumen KB terbit, biaya bulan ini vs batas                                                                                                      |
| POST    | `/ai/ask`               | `ai:use`                   | `{ question, leadId? }` → `answer`, `handoff`, `handoffReason`. KB kosong → handoff tanpa memanggil model                                                                                |
| POST    | `/ai/reply-suggestion`  | `ai:use`                   | `{ incomingMessage, leadId?, taskId? }` → `reply`, `detectedIntent`, `handoff`                                                                                                           |
| POST    | `/ai/outreach-draft`    | `ai:use` + `outreach:work` | `{ taskId, instructions? }` → `message`, `rationale` (hanya tugas `DRAFT`/`FOLLOW_UP`; tidak mengubah tugas — terapkan via `PATCH /outbound/tasks/:id/draft` dengan `aiGenerated: true`) |
| POST    | `/ai/leads/:id/score`   | `ai:use` + `leads:manage`  | → `score`, `interestLevel` (saran), `reasons`, `recommendedAction`. Menyimpan `leads.score` + aktivitas `AI_ANALYSIS`                                                                    |
| POST    | `/ai/leads/:id/summary` | `ai:use` + `leads:read`    | → `summary`, `keyPoints`, `nextStep`. Dicatat sebagai aktivitas `AI_ANALYSIS`                                                                                                            |
| GET     | `/ai/usage?days=30`     | `analytics:read`           | Total, per fitur, per model, per hari (WIB). Interaksi simulasi dihitung terpisah                                                                                                        |
| GET     | `/ai/interactions`      | `analytics:read`           | Log interaksi (filter `type`, `status`)                                                                                                                                                  |
| GET/PUT | `/ai/settings`          | `settings:manage`          | `{ model, mode, monthlyBudgetUsd, pricing: { [model]: { inputPer1M, outputPer1M } } }`. `mode: AUTO_REPLY` ditolak sampai ada kanal resmi                                                |

## Knowledge Base

| Method | Path                       | Permission         | Keterangan                                                    |
| ------ | -------------------------- | ------------------ | ------------------------------------------------------------- |
| GET    | `/knowledge-documents`     | `ai:use`           | Filter `category`, `status` (default: selain arsip), `search` |
| GET    | `/knowledge-documents/:id` | `ai:use`           |                                                               |
| POST   | `/knowledge-documents`     | `knowledge:manage` | `{ title, category, content, status }`                        |
| PATCH  | `/knowledge-documents/:id` | `knowledge:manage` | Perubahan judul/isi menaikkan `version`                       |
| DELETE | `/knowledge-documents/:id` | `knowledge:manage` |                                                               |

---

# Fase 4 — Integrasi TikTok

| Method | Path                                               | Akses                                   | Keterangan                                                                                                                                        |
| ------ | -------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/integrations/overview`                           | `integrations:read`                     | Status kemampuan (Login Kit, Webhook, Mock, Business API, Lead Gen, Messaging), Redirect URI, URL webhook, scope, akun & koneksinya (tanpa token) |
| GET    | `/integrations/logs`                               | `integrations:read`                     | Log integrasi (filter `integrationId`, `onlyErrors`). Payload tersensor                                                                           |
| POST   | `/integrations/tiktok/accounts/:accountId/connect` | `integrations:manage`                   | `{ provider: "TIKTOK_LOGIN_KIT" \| "MOCK" }` → `{ authorizeUrl }`; browser diarahkan ke URL ini                                                   |
| GET    | `/integrations/tiktok/callback`                    | publik (redirect browser dari TikTok)   | `code`, `state`, `scopes`, `error`, `error_description` → redirect 302 ke `/integrations?connected=<id>` atau `/integrations?error=<pesan>`       |
| GET    | `/integrations/tiktok/mock/state`                  | `integrations:manage`                   | Info state untuk halaman persetujuan simulasi (Mock saja)                                                                                         |
| POST   | `/integrations/:id/sync`                           | `integrations:manage`                   | Refresh token bila perlu, ambil profil, perbarui akun → `{ status, followersCount, message }`                                                     |
| POST   | `/integrations/:id/disconnect`                     | `integrations:manage`                   | Revoke di TikTok (best effort), hapus token, status `REVOKED`                                                                                     |
| POST   | `/webhooks/tiktok`                                 | publik, diverifikasi `TikTok-Signature` | Event `authorization.removed` mencabut integrasi; event duplikat diabaikan                                                                        |

Endpoint TikTok yang dipanggil (diverifikasi dari developers.tiktok.com pada 16 Okt 2026):

| Endpoint                                                 | Dipakai untuk                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `https://www.tiktok.com/v2/auth/authorize/`              | Halaman otorisasi (client_key, response_type=code, scope, redirect_uri, state)                       |
| `POST https://open.tiktokapis.com/v2/oauth/token/`       | Tukar code (`grant_type=authorization_code`) & refresh (`grant_type=refresh_token`), form-urlencoded |
| `POST https://open.tiktokapis.com/v2/oauth/revoke/`      | Cabut token                                                                                          |
| `GET https://open.tiktokapis.com/v2/user/info/?fields=…` | Profil; field diminta sesuai scope yang diberikan                                                    |

---

# Fase 5 — Tracking konversi & analitik

Spesifikasi lengkap untuk tim Solid Mini (landing page & backend): [CONVERSION-API.md](CONVERSION-API.md).

| Method | Path                            | Akses                                                | Keterangan                                                                                                                                                      |
| ------ | ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/campaigns/:id/tracking-links` | `campaigns:read`                                     | Link tracking + statistik (klik, pengunjung unik, registrasi terverifikasi)                                                                                     |
| POST   | `/campaigns/:id/tracking-links` | `campaigns:manage`                                   | `{ name?, destinationUrl, tiktokAccountId?, utmSource?, utmMedium?, utmContent? }` — UTM campaign = tracking code                                               |
| PATCH  | `/tracking-links/:id`           | `campaigns:manage`                                   | `{ name?, isActive? }`                                                                                                                                          |
| GET    | `/t/:code`                      | publik                                               | Redirect 302 ke tujuan + UTM + `smge_ref` + `smge_vid`; mencatat `CTA_CLICK` (dedup 30 menit/pengunjung, bot diabaikan)                                         |
| POST   | `/track/events`                 | publik (CORS `TRACKING_ALLOWED_ORIGINS`, rate limit) | `{ type: LANDING_VISIT\|CTA_CLICK\|STORE_CLICK, ref?, visitorId?, utm… }` — tidak terverifikasi                                                                 |
| POST   | `/conversions`                  | HMAC (`X-SMGE-Timestamp`, `X-SMGE-Signature`)        | Event terverifikasi dari backend Solid Mini; idempoten per `eventId`                                                                                            |
| GET    | `/analytics/report`             | `analytics:read`                                     | `days`, `lane`, `campaignId`, `accountId`, `model` (`LAST_TOUCH`/`FIRST_TOUCH`) → KPI, funnel, per jalur, pertumbuhan prospek, status, campaign, akun, operator |

`GET /analytics/overview` kini mengembalikan `registrations` & `activeUsers` dari event terverifikasi (sumber
`ACTUAL`) dan `registrationsOperator` (konfirmasi operator, sumber `MANUAL`). `CampaignDto.stats.registrationsVerified`
= registrasi terverifikasi dengan atribusi last-touch.

---

# WhatsApp (WAHA)

Daftar endpoint, aturan, dan keterbatasan: [WHATSAPP.md](WHATSAPP.md#endpoint).
