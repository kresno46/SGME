# Pengambilan followers melalui browser

Modul ini membaca username dari daftar followers yang tampil di browser operator. Ia tidak
memakai token Login Kit, endpoint TikTok privat, cookie, atau password. Tidak ada pengiriman DM.
Sumber daftar dilaporkan operator dan tidak diverifikasi sebagai relasi follower oleh API TikTok.

## Pemakaian

1. Login, pilih akun pengirim Outbound aktif milik Anda, lalu buka **Ambil followers**.
   Akses memerlukan `outreach:work` dan `leads:import`, termasuk role Marketing Operator bawaan.
2. Unduh ZIP, ekstrak, buka `chrome://extensions` atau `edge://extensions`, aktifkan Developer mode,
   pilih **Load unpacked**, lalu pilih folder berisi `manifest.json`.
3. Di browser yang sama, buka `https://www.tiktok.com/@username` akun sumber yang Anda kelola.
   Login dan selesaikan verifikasi sendiri bila diminta. Buka **Followers/Pengikut**, bukan Following.
4. Klik extension **SMGE Followers**, centang konfirmasi, pilih **Mulai**. Popup boleh ditutup;
   proses tetap berjalan pada tab. **Jangan refresh/menutup tab sebelum ekspor** karena hasil
   disimpan sementara dalam memori tab.
5. Klik **Hentikan** bila diperlukan lalu **Ekspor JSON**. Pilih file di dialog SMGE, periksa akun
   sumber dan daftar username, kemudian **Simpan ke database**.
6. File boleh berasal dari akun TikTok lain. Prospek menjadi milik pemilik akun pengirim yang dipilih;
   `sourceAccountId` menghubungkan prospek ke akun pengirim tersebut. Username sumber asli dari file
   disimpan pada catatan, aktivitas (`collectedFromUsername`), dan audit, bukan diganti menjadi pengirim.
   Hasil masuk CRM dengan sumber `IMPORT`, tag `tiktok-followers` dan `browser-collected`,
   catatan asal, aktivitas import, serta audit ringkasan. Prospek yang memenuhi syarat muncul di antrean Outbound.

## Batas dan perilaku

- Maksimal 250 username per batch. Collector menggulir setiap 2 detik; berhenti setelah 10 detik
  tanpa username baru, 5 menit, daftar ditutup, profil berubah, atau mendeteksi elemen verifikasi.
  Ia tidak mencoba melewati CAPTCHA atau pembatasan TikTok.
- Tidak menjamin seluruh followers. TikTok dapat membatasi daftar yang terlihat, mengubah struktur
  halaman, atau tidak menyediakan dialog yang dikenali. Collector mencari `[role="dialog"]`
  atau `[data-e2e="follow-info-popup"]`; jangan memperluas ke seluruh halaman karena bisa mengambil
  akun rekomendasi. Bila tak dikenali, tampilkan error dan perbarui selector setelah inspeksi browser.
- Bila tab Following memiliki penanda `aria-selected`, collector menolaknya. Pada tampilan lain,
  operator tetap perlu memastikan daftar yang dibuka memang Followers. Tidak ada verifikasi server
  bahwa username dalam file benar-benar followers atau bahwa pemiliknya menyetujui komunikasi.
- File harus cocok dengan username akun yang dipilih. Pengunggahan ulang aman dari duplikat berdasarkan
  identitas ternormalisasi. Data lama, termasuk identitas terhapus, tidak dipulihkan atau ditimpa;
  akun sendiri dan entri larangan kontak dilewati. Tidak ada record izin komunikasi yang dibuat.
- Penyimpanan lead dan aktivitas berjalan dalam satu transaksi, dengan unique index dan
  `createMany(skipDuplicates)` untuk menangani upload bersamaan. Audit mengikuti transaksi berhasil.
- Browser collector tidak perlu OAuth. Hubungan ke akun project dipilih saat import; menghubungkan
  Login Kit tidak membuat sesi browser atau memberi kemampuan kirim DM.
- File JSON bersifat input operator: jangan memperlakukannya sebagai bukti terverifikasi API.

## Pengembangan dan validasi

Sumber extension: `infrastructure/follower-collector`. Setelah mengubah sumber, format dan uji lalu
buat ulang ZIP yang dilayani dashboard:

```powershell
node --test infrastructure/follower-collector/collector.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File infrastructure/scripts/package-follower-collector.ps1
pnpm --filter @smge/shared test
pnpm --filter @smge/api test --runInBand follower-import
pnpm --filter @smge/api test:e2e --testPathPattern followers
```

Endpoint: `POST /api/outbound/followers/import`, body `{ accountId, batch }`. Endpoint memakai
autentikasi sesi, CSRF, RBAC, dan rate limit aplikasi; extension tidak mengaksesnya langsung.
Format batch: `smge-followers-v1`, `accountUsername`, `collectedAt` (ISO UTC), `stopReason`,
`followers: [{ username, displayName? }]`. Skema bersama menolak properti lain dan batch berlebih.

Tes collector memakai fixture DOM terkontrol, bukan sesi TikTok sungguhan. Sebelum mengandalkan
collector pada akun produksi, uji manual di TikTok untuk memastikan selector cocok, Followers
yang dipilih, perilaku stop, ekspor, dan akun sumber. Perubahan UI TikTok dapat memerlukan penyesuaian.

Referensi izin extension: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
dan [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).
