# Kirim Email

**Status: disembunyikan sementara untuk semua role.** Flag `HIDE_EMAIL_OUTREACH` di
`apps/dashboard/lib/feature-flags.ts` menyembunyikan menu dan mengarahkan akses langsung
`/email` ke dashboard. Implementasi dan data tetap dipertahankan. Ini hanya pengaturan
tampilan; pengiriman server tetap dikendalikan terpisah oleh `EMAIL_OUTREACH_ENABLED`
(default `false`). Untuk membuka halaman kembali, ubah flag UI menjadi `false` dan deploy ulang.

Menu **Kirim Email** tersedia untuk Super Admin, Admin, dan Marketing yang memiliki izin
`outreach:work`. Viewer tidak dapat membuka halaman maupun API-nya.

## Cara memakai

1. Buka **Kirim Email → Tulis email**.
2. Isi satu alamat per baris. Nama opsional: `Budi <budi@example.com>`.
   Alamat duplikat dalam pengiriman yang sama dihitung sekali. Maksimal 40 penerima per batch.
3. Pilih template pribadi atau tulis subjek dan pesan. Gunakan `{{nama}}` dan `{{email}}`.
   Link ditulis langsung. Variabel yang tidak dikenal ditolak sebelum antrean dibuat.
4. Klik **Tinjau & kirim**, periksa pesan setiap penerima dan pengirim perusahaan, lalu centang
   konfirmasi dan klik **Kirim … email**. Tidak ada persetujuan admin tambahan.
5. Pantau **Riwayat pengiriman**. Pesan dikirim satu per satu dari server tanpa extension.
6. Gunakan **Batalkan** selama pesan masih menunggu. Untuk email yang diterima server,
   gunakan **Tulis follow-up**, lalu tinjau dan kirim pesan baru.

**Template saya** mendukung tambah, edit, hapus, dan pakai template. Template tidak mengubah
isi email yang sudah diantrekan. Admin dan Marketing hanya mengakses riwayat dan template
milik sendiri; Super Admin dapat melihat dan mengelola seluruh data.

Versi awal memakai satu alamat pengirim perusahaan dari konfigurasi SMTP, bukan login email
masing-masing marketing. Penerima dimasukkan manual atau ditempel beberapa baris. Impor CSV,
lampiran, HTML, sinkronisasi inbox, pelacakan dibaca, dan webhook bounce belum tersedia.
Balasan diperiksa di inbox perusahaan; permintaan berhenti dihubungi harus dicatat pengelola
di daftar larangan kontak email sebelum pengiriman selanjutnya. Followers TikTok tidak
otomatis menyediakan alamat email.

## Mengaktifkan pengiriman

Migrasi baru hanya menambah tabel `outreach_emails` dan `email_outreach_templates` beserta
enum status. Jalankan `pnpm --filter @smge/database generate` dan
`pnpm --filter @smge/database migrate:deploy`, lalu restart API dan dashboard setelah deploy.

Siapkan konfigurasi server (jangan masukkan password SMTP ke form marketing):

```dotenv
EMAIL_OUTREACH_ENABLED=true
SMTP_HOST=smtp.perusahaan.example
SMTP_PORT=587
SMTP_USER=marketing@perusahaan.example
SMTP_PASSWORD=isi_di_server
SMTP_FROM="Marketing Bias Growth <marketing@perusahaan.example>"
```

Gunakan server dan alamat pengirim yang diizinkan penyedia email perusahaan. Port 465 memakai
TLS langsung; port 587 mengikuti STARTTLS server. SMTP ini juga digunakan fitur email sistem
yang sudah ada. Flag outreach hanya mengaktifkan antrean baru, tidak mengubah email reset password.
Tanpa flag aktif atau host SMTP, tombol pengiriman dinonaktifkan dan API menolak pembuatan antrean.
Template tetap dapat disimpan. Pengiriman sungguhan belum diuji oleh pengujian otomatis.

## Status dan batas

| Status                | Makna                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Menunggu              | Tersimpan di database, belum diklaim worker. Bisa dibatalkan.                                       |
| Diproses              | Worker sudah mengklaim. Tidak boleh dibatalkan atau diulang otomatis.                               |
| Diterima server email | SMTP menerima alamat tujuan. Bukan bukti masuk inbox atau dibaca.                                   |
| Gagal                 | SMTP menolak penerima/pengiriman. Periksa alasan dan konfigurasi.                                   |
| Perlu diperiksa       | Koneksi atau proses terputus; hasil belum pasti. Periksa sistem email sebelum membuat kiriman baru. |
| Dibatalkan            | Operator membatalkan antrean menunggu, penerima masuk DNC, atau pengguna nonaktif.                  |

Worker memproses satu pesan setiap tick lima detik per proses API. Klaim database memakai
`FOR UPDATE SKIP LOCKED`, sehingga worker bersamaan tidak mengirim baris yang sama.
Penolakan satu penerima tidak menghalangi penerima berikutnya. Tidak ada retry otomatis untuk
hasil gagal atau belum pasti. Klaim macet lebih dari lima menit ditandai perlu diperiksa.

Batas awal 100 email yang dibuat dalam 24 jam berjalan per pengguna, termasuk yang kemudian
gagal/dibatalkan. Pemeriksaan kuota dan pengiriman ulang request menggunakan kunci idempotensi
serta transaksi per pengguna. DNC diperiksa saat antre dan sesaat sebelum SMTP. Riwayat menampilkan
100 pesan terbaru; kartu ringkasan menghitung seluruh catatan yang boleh dilihat pengguna.

## Verifikasi

API integration tests memakai database test dan gateway SMTP palsu. Browser test mengintersep
semua API; tidak membuat akun maupun mengirim email sungguhan. Tes alur email dijalankan
saat flag UI dibuka. Saat disembunyikan, periksa bahwa menu hilang dan `/email` kembali
ke dashboard untuk setiap role.

```text
pnpm --filter @smge/api test:e2e email-outreach.e2e-spec.ts
node apps/dashboard/test/email-outreach.browser.cjs
```
