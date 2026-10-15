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

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/health` | publik | Status database & Redis. `503` bila database tidak terjangkau |

## Auth

| Method | Path | Akses | Body / keterangan |
|---|---|---|---|
| POST | `/auth/login` | publik | `{ email, password }` → `{ status: "AUTHENTICATED", user }` atau `{ status: "TWO_FACTOR_REQUIRED", challengeToken }` |
| POST | `/auth/2fa/verify` | publik | `{ challengeToken, code }` |
| POST | `/auth/refresh` | cookie | Rotasi refresh token |
| POST | `/auth/logout` | login | Mencabut sesi saat ini |
| GET | `/auth/me` | login | Profil + permission |
| GET | `/auth/sessions` | login | Daftar sesi aktif (`current` menandai sesi ini) |
| DELETE | `/auth/sessions/:id` | login | Akhiri sesi lain milik sendiri |
| POST | `/auth/change-password` | login | `{ currentPassword, newPassword, confirmPassword }` — mencabut sesi lain |
| POST | `/auth/forgot-password` | publik | `{ email }` — respons selalu sama |
| POST | `/auth/reset-password` | publik | `{ token, password, confirmPassword }` |
| POST | `/auth/2fa/setup` | login | → `{ otpauthUrl, qrCodeDataUrl, secret }` |
| POST | `/auth/2fa/enable` | login | `{ code }` |
| POST | `/auth/2fa/disable` | login | `{ password, code }` |

## Pengguna & role

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/users` | `users:read` | Filter `role`, `status`, `search` |
| POST | `/users` | `users:manage` | `{ name, email, role, password }` — hanya role di bawah aktor |
| PATCH | `/users/:id` | `users:manage` | `{ name?, role?, status? }` — tidak bisa mengubah role/status diri sendiri; `DISABLED` mencabut semua sesi |
| POST | `/users/:id/reset-password` | `users:manage` | `{ password }` |
| POST | `/users/:id/unlock` | `users:manage` | Buka kunci login |
| POST | `/users/:id/reset-2fa` | `users:manage` | Matikan 2FA pengguna |
| GET | `/roles` | `roles:read` | Role + permission + jumlah pengguna |

## Audit

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/audit-logs` | `audit:read` | Filter `action` (prefix), `actorId`, `entityType`, `search` |

## Akun TikTok

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/tiktok-accounts` | `accounts:read` | Filter `lane`, `status`, `search`; `sortBy` (`followersCount`/`createdAt`/`username`), `sortDir` |
| GET | `/tiktok-accounts/:id` | `accounts:read` | Termasuk status integrasi (tanpa token) dan statistik |
| POST | `/tiktok-accounts` | `accounts:manage` | `{ username, displayName, lane, accountType?, isVerified?, followersCount?, status?, profileUrl?, avatarUrl?, notes? }` |
| PATCH | `/tiktok-accounts/:id` | `accounts:manage` | Field parsial; perubahan followers → sumber `MANUAL` |
| DELETE | `/tiktok-accounts/:id` | `accounts:manage` | `409` bila akun punya riwayat percakapan/tugas outbound (arsipkan saja) |

Username dinormalisasi (`@Solid.Mini` → `solid.mini`) dan unik.

## Analitik

| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/analytics/overview` | `dashboard:view` | Ringkasan akun, followers per sumber data, per jalur, top 10 akun, metrik CRM. Data `SIMULATED` tidak dijumlahkan; metrik yang belum tersedia bernilai `null` |
