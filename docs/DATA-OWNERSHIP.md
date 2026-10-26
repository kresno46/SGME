# Kepemilikan data marketing

Setiap akun TikTok, prospek, dan tugas outreach memiliki `owner_id`. Pemilik berbeda dari
operator yang ditugaskan menangani prospek. Mengubah operator tidak memindahkan kepemilikan.

- Semua role selain `SUPER_ADMIN` hanya dapat membaca dan mengubah data miliknya, sesuai izin fitur.
- Super Admin dapat melihat seluruh akun, prospek, tugas, dan hasil pengiriman. Label pemilik
  ditampilkan pada daftar akun dan prospek.
- Pemilik akun TikTok baru selalu ditetapkan server dari user login. `ownerId` yang dikirim klien
  tidak dapat dipakai untuk mengambil alih data.
- Followers yang diimpor mengikuti pemilik akun pengirim yang dipilih saat impor; akun sumber pada
  file boleh berbeda dan tetap dicatat sebagai asal pengambilan. Data prospek manual/CSV mengikuti pembuatnya.
- Tugas DM memerlukan akun pengirim dan prospek dengan pemilik yang sama. Persetujuan/review tidak
  mengubah pemilik. Pada alur Kirim DM TikTok, Marketing Operator langsung memasukkan pesan ke antrean
  setelah meninjau isi dan penerima, tanpa persetujuan Admin terpisah. Mekanisme review lama tetap tersimpan.
- Username akun TikTok, username prospek, email, dan nomor telepon unik per pemilik, sehingga dua
  marketing dapat mencatat akun sumber dan kontak yang sama secara terpisah. Setiap record tetap
  memiliki satu pemilik; mendaftarkan username yang sama tidak memberikan akses ke record user lain.
- Antrean browser dan operasi pengiriman memeriksa akses akun sebelum memproses. Laporan hasil
  tetap terikat pada user pengirim, client, dan ID percobaan. Super Admin dapat membaca hasil semua user.

Pembatasan berlaku di backend untuk daftar, detail berdasarkan ID, pencarian duplikat, ekspor,
impor/merge, catatan, consent, DNC, pembuatan tugas, review, AI dengan konteks prospek/tugas,
dan pengiriman browser. Filter `operatorId`, `accountId`, atau ID lain tidak menggantikan batas pemilik.
Konteks user menggunakan AsyncLocalStorage per request dan juga diteruskan ke transaksi asynchronous.
Worker internal tetap memiliki akses pemeliharaan; endpoint HTTP tersembunyi yang masih menggunakan
laporan lintas data dibatasi ke Super Admin (campaign, integrasi, tracking, dan laporan analitik penuh).
Dashboard marketing hanya menghitung akun, prospek, tugas, serta penggunaan AI miliknya.

## Data bersama

Template dengan `created_by_id = NULL` adalah template bawaan yang dapat dibaca semua marketing,
tetapi hanya diubah/dihapus Super Admin. Template buatan user hanya terlihat oleh pembuat dan
Super Admin. Knowledge Base adalah materi produk bersama yang dikelola Super Admin.

Daftar larangan kontak tetap berlaku lintas marketing supaya permintaan berhenti tetap dihormati.
Marketing hanya melihat entri yang ditambahkannya dan tidak mendapat daftar atau hitungan prospek
marketing lain. Pencabutan larangan global hanya boleh dilakukan Super Admin.

## Migrasi data lama

Migrasi `20261022090000_data_ownership` menambahkan kolom dan indeks tanpa menghapus data.
Bila hanya ada satu Super Admin, data bisnis lama ditempatkan di bawah user tersebut. Jika ada
beberapa Super Admin, pemilik dibiarkan NULL; data itu hanya terlihat oleh Super Admin sampai ada
penetapan yang jelas. Data lama tidak otomatis dibagikan ke marketing dan tidak dipindahkan dengan
mengubah field operator. Tidak ada endpoint pemindahan pemilik massal pada perubahan ini.

Backup lokal database development dibuat sebelum migrasi di `%LOCALAPPDATA%\SMGE\backups`.
Izin marketing diperbarui untuk mengelola akun sendiri, impor/ekspor, menghapus prospek sendiri,
serta membuat template pribadi. Izin persetujuan pesan tetap mengikuti role/review yang ada.

## Verifikasi

`apps/api/test/data-ownership.e2e-spec.ts` menggunakan dua marketing dan satu Super Admin di
database test terpisah. Cakupan mencakup ID/filter palsu, akses detail dan mutasi, ekspor,
duplikat per user, impor followers/CSV, template bersama dan privat, konteks AI, dashboard,
request paralel, review Super Admin, dan antrean pengiriman tanpa DM TikTok sungguhan.

## Template pribadi dan rekomendasi

Tab Template menampilkan **Template saya** dan **Rekomendasi admin**. User membuat template pribadi
melalui **Template baru**, atau memilih **Salin ke template saya** pada rekomendasi. Salinan membuka
form yang sudah terisi; setelah disimpan, server membuat ID baru dengan pemilik dari sesi login.
Mengedit atau menghapus salinan tidak mengubah rekomendasi aslinya. Super Admin juga mempunyai
bagian **Template user lain** untuk melihat dan mengelola template pribadi semua user.

## Dashboard per role

Dashboard menampilkan akun Outbound aktif, jumlah followers yang tersimpan dari import, jumlah
aktivitas DM terkirim/dikonfirmasi hari ini dan tujuh hari terakhir, antrean, hasil yang perlu
diperiksa, akun pengirim, dan pengiriman terbaru. Angka pengiriman dihitung per aktivitas, sehingga
follow-up dihitung sebagai pesan tersendiri tanpa menghitung ulang laporan hasil yang sama.
Batas hari mengikuti Asia/Jakarta; perbandingan timestamp SQL memakai UTC secara eksplisit agar
tidak bergantung pada zona waktu PostgreSQL.

Marketing dan Admin hanya mendapat agregat serta daftar data miliknya. Super Admin mendapat
ringkasan seluruh tim dan label pemilik akun. Viewer memakai cakupan datanya sendiri dan tampilan
baca saja, tanpa pintasan pengiriman atau pengelolaan user. Detail Dashboard sebelumnya tetap
tersedia di **Detail akun & prospek**: tertutup awal untuk Marketing dan terbuka untuk role lain.
Ringkasan diperbarui setiap 15 detik; tautan per akun/pengiriman membuka akun yang bersangkutan.
