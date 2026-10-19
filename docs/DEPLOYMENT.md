# Panduan Deployment — VPS Ubuntu

Dari server kosong sampai SMGE dapat diakses di `https://<domain>`.

> **Status pengujian:** konfigurasi Nginx telah diuji berjalan (routing, redirect HTTPS, header keamanan, rate limit,
> batas upload) dan struktur Docker Compose telah divalidasi. **Image Docker dan Compose belum pernah dijalankan**
> karena Docker tidak tersedia di mesin pengembangan — deployment pertama ini sekaligus menjadi uji integrasinya.
> Ikuti langkah verifikasi di bagian 8.

## Arsitektur produksi

```text
Internet ──443/80──▶ nginx ──┬─ /api/*  ─▶ api (NestJS :4000) ──┬─▶ postgres (internal)
                             │                                  └─▶ redis (internal, password)
                             └─ /       ─▶ dashboard (Next.js :3000)
                     certbot (perpanjangan SSL)      worker (BullMQ: retensi, sinkron TikTok)
                     migrate (sekali jalan: migrasi + seed)
```

Hanya port **80** dan **443** yang terbuka. Database & Redis tidak dapat diakses dari internet.

## 1. Kebutuhan

| Item   | Minimum disarankan                                                  |
| ------ | ------------------------------------------------------------------- |
| VPS    | Ubuntu 24.04 LTS (22.04 juga bisa), 2 vCPU, 4 GB RAM, 40 GB SSD     |
| Domain | Subdomain, mis. `smge.domainanda.id`, dengan **A record** ke IP VPS |
| Akses  | SSH dengan key, pengguna non-root ber-`sudo`                        |

Build image memakai ~2–3 GB RAM. Pada VPS 2 GB, tambahkan swap (langkah 2.4).

## 2. Siapkan server

### 2.1 Pengguna & SSH

```bash
# sebagai root, sekali saja
adduser smge
usermod -aG sudo smge
rsync --archive --chown=smge:smge ~/.ssh /home/smge

# matikan login root & password (pastikan login dengan key sudah berhasil!)
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

### 2.2 Firewall & pembaruan otomatis

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban unattended-upgrades git curl
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo dpkg-reconfigure -plow unattended-upgrades
```

> Docker memodifikasi iptables sendiri; karena itu Compose produksi **tidak** membuka port selain 80/443.

### 2.3 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker smge
# keluar lalu login ulang agar grup docker berlaku
docker version && docker compose version
```

### 2.4 (Opsional) Swap 2 GB

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Ambil kode & konfigurasi

```bash
sudo mkdir -p /opt/smge && sudo chown smge:smge /opt/smge
git clone <url-repository> /opt/smge
cd /opt/smge
cp .env.production.example .env.production
chmod 600 .env.production
```

Buat semua secret (jalankan beberapa kali untuk nilai berbeda):

```bash
openssl rand -hex 32          # POSTGRES_PASSWORD, REDIS_PASSWORD, CONVERSION_API_SECRET
openssl rand -base64 48 | tr -d '\n'; echo   # JWT_ACCESS_SECRET
openssl rand -base64 32       # ENCRYPTION_KEY (harus 32 byte base64)
```

Isi `.env.production`:

| Variabel                                                           | Catatan                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `DOMAIN`, `LETSENCRYPT_EMAIL`                                      | Domain dashboard & email pemberitahuan SSL                                          |
| `POSTGRES_PASSWORD`                                                | Gunakan hex (tanpa karakter khusus) — nilai yang **sama** ditulis di `DATABASE_URL` |
| `REDIS_PASSWORD`                                                   | Nilai yang **sama** ditulis di `REDIS_URL=redis://:<password>@redis:6379`           |
| `APP_PUBLIC_URL`, `CORS_ORIGINS`                                   | `https://<domain>`                                                                  |
| `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`                              | Secret acak (lihat atas)                                                            |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`                | Akun pertama; ganti password setelah login                                          |
| `SMTP_*`                                                           | Wajib agar email reset password terkirim                                            |
| `OPENAI_API_KEY`, `OPENAI_MODEL`                                   | Opsional (AI Sales Agent)                                                           |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | Opsional (`https://<domain>/api/integrations/tiktok/callback`)                      |
| `CONVERSION_API_SECRET`, `TRACKING_ALLOWED_ORIGINS`                | Opsional (tracking konversi, lihat [CONVERSION-API.md](CONVERSION-API.md))          |

> ⚠️ **Simpan `ENCRYPTION_KEY` di password manager.** Tanpa kunci ini, token integrasi TikTok dan secret 2FA di
> database tidak dapat dibaca kembali (backup database saja tidak cukup).

API **menolak start** bila secret masih nilai contoh, URL bukan https, `COOKIE_SECURE` bukan `true`, atau mode
simulasi (`TIKTOK_USE_MOCK`, `AI_PROVIDER=simulated`) aktif. Skrip juga menolak berjalan bila masih ada `GANTI_…`.

## 4. Sertifikat SSL (pertama kali)

Pastikan DNS sudah mengarah ke VPS (`dig +short <domain>` menampilkan IP VPS), lalu:

```bash
./infrastructure/scripts/smge.sh init-ssl
```

Perpanjangan berjalan otomatis lewat layanan `certbot` (cek 2× sehari). Agar Nginx memakai sertifikat baru,
tambahkan cron reload harian (langkah 7).

## 5. Jalankan

```bash
./infrastructure/scripts/smge.sh up
```

Urutan otomatis: `postgres` & `redis` sehat → `migrate` (migrasi + seed idempoten) → `api` & `worker` →
`dashboard` → `nginx`. Build pertama memakan waktu beberapa menit.

## 6. Verifikasi

```bash
./infrastructure/scripts/smge.sh status          # semua layanan "healthy"/"running", migrate "exited (0)"
curl -I http://<domain>                          # 301 ke https
curl https://<domain>/api/health                 # {"status":"ok",...}
```

Lalu buka `https://<domain>`, login dengan akun Super Admin, **ganti password**, dan **aktifkan 2FA**.

## 7. Backup & pemeliharaan (cron)

```bash
crontab -e
```

```cron
# Backup database tiap hari 01.30 (retensi BACKUP_RETENTION_DAYS)
30 1 * * * cd /opt/smge && ./infrastructure/scripts/smge.sh backup >> /opt/smge/backups/backup.log 2>&1
# Muat ulang Nginx tiap hari agar sertifikat yang diperpanjang terpakai
15 4 * * * cd /opt/smge && ./infrastructure/scripts/smge.sh reload-nginx > /dev/null 2>&1
```

- **Salin backup ke luar server** (offsite), mis. `rclone copy /opt/smge/backups remote:smge-backups` atau
  object storage. Backup di server yang sama tidak melindungi dari kehilangan server.
- **Uji restore** secara berkala di server staging: `./infrastructure/scripts/smge.sh restore backups/<file>.dump`.
- Log container dirotasi otomatis (10 MB × 5 file per layanan). Lihat log: `smge.sh logs api`.

## 8. Checklist deployment pertama

Karena image belum pernah dijalankan sebelumnya, periksa hal berikut pada deployment pertama:

- [ ] `docker compose … build` selesai tanpa error untuk target `api` dan `dashboard`
- [ ] Layanan `migrate` keluar dengan kode 0 (`docker compose … logs migrate`)
- [ ] `api` healthy; `GET /api/health` menunjukkan database & redis `up`
- [ ] Dashboard dapat dibuka, aset CSS/JS termuat, login berhasil, cookie bertanda `Secure`
- [ ] `worker` berjalan (`logs worker` menampilkan "Worker berjalan")
- [ ] Redirect HTTP→HTTPS & sertifikat valid (`curl -vI https://<domain>`)
- [ ] Backup manual berhasil dan file `.dump` tidak kosong
- [ ] (Bila dipakai) koneksi TikTok, AI, dan Conversion API diuji dari halaman Integrasi / AI Sales Agent

## 9. Pembaruan aplikasi

```bash
cd /opt/smge
./infrastructure/scripts/smge.sh update     # git pull → backup → build → jalankan (migrasi otomatis)
```

**Rollback:** `git checkout <commit-sebelumnya>` lalu `smge.sh up`. Migrasi database tidak dibatalkan otomatis;
bila migrasi baru bermasalah, pulihkan backup yang dibuat otomatis sebelum update (`smge.sh restore …`).

## 10. Pemecahan masalah

| Gejala                              | Periksa                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `api` restart terus                 | `smge.sh logs api` — biasanya "Konfigurasi produksi tidak aman" / env tidak valid                          |
| `migrate` gagal                     | Password di `DATABASE_URL` ≠ `POSTGRES_PASSWORD`, atau karakter khusus tidak di-encode                     |
| 502 dari Nginx                      | `api`/`dashboard` belum healthy; `smge.sh status`                                                          |
| `init-ssl` gagal                    | DNS belum mengarah ke VPS, atau port 80 terpakai/terblokir                                                 |
| Login berhasil tapi langsung keluar | `APP_PUBLIC_URL`/`CORS_ORIGINS` tidak sama dengan domain yang dibuka                                       |
| Rate limit (429) terlalu ketat      | Sesuaikan `limit_req_zone` di `infrastructure/nginx/templates/smge.conf.template` atau `THROTTLE_*` di env |

## 11. Checklist keamanan

- [ ] SSH hanya dengan key, root login nonaktif, UFW hanya 22/80/443, fail2ban aktif
- [ ] `.env.production` `chmod 600`, tidak pernah di-commit; `ENCRYPTION_KEY` tersimpan aman di luar server
- [ ] Password Super Admin awal sudah diganti, 2FA aktif untuk semua Admin
- [ ] SMTP terkonfigurasi (reset password)
- [ ] Backup harian + salinan offsite + uji restore
- [ ] Pembaruan keamanan OS otomatis aktif; jalankan `pnpm audit --prod` sebelum rilis
