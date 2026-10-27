# Pengiriman DM melalui browser (versi awal)

Modul ini mencoba mengirim pesan melalui tampilan TikTok di Chrome/Edge. Ia adalah satu alat
di extension **SMGE Toolkit** (bersama pengambil followers) dan terpisah dari Login Kit. Tidak memakai endpoint privat, password, atau cookie
TikTok di server. Struktur UI TikTok belum diuji pada sesi akun sungguhan; bila identitas atau kontrol
chat tidak dikenali, pengiriman berhenti sebelum tombol kirim ditekan.

## Pemakaian

**Versi 0.2.0:** pengetikan dan Enter/klik memakai input native browser lewat `chrome.debugger`,
bukan `execCommand` atau event input JavaScript buatan. Perubahan ini menangani kegagalan
`Isi editor tidak cocok dengan pesan yang disetujui` yang terlihat pada log percobaan versi sebelumnya.
Template harus terverifikasi utuh di editor sebelum otorisasi dan Enter/klik dilakukan.

Unduh ulang ZIP, ekstrak dan Reload/pasang ulang extension, lalu pastikan popup bertuliskan **SMGE Toolkit v1.0.0**.
Versi ini menambah izin **debugger** yang wajib dideklarasikan saat pemasangan/update; Chrome tidak
mengizinkannya sebagai permission opsional. Implementasi hanya melampirkan debugger ke tab TikTok
pengiriman dan memakai domain Input, lalu melepasnya setelah percobaan. Tutup DevTools pada tab itu
selama percobaan karena DevTools dapat memutus sesi debugger extension. Tidak ada DM sungguhan yang
dikirim oleh tes otomatis.

Input native sudah diuji dengan Edge/Chromium headless pada halaman lokal yang hanya menerima
event input/Enter tepercaya, termasuk emoji dan pesan beberapa baris. Halaman uji tidak terhubung
ke TikTok dan semua request jaringannya diblokir; ini belum merupakan bukti pengiriman ke akun TikTok.

Pengenalan layout dari diagnostik versi 0.1.3 tetap dipakai: `dm-new-chatbox`, `chat-uniqueid`,
`dm-new-input-editor` (DraftJS), dan `dm-new-message-list`. Akun pengirim dan penerima harus cocok.
Enter/klik dicoba satu kali; hasil tetap harus terlihat sebagai pesan baru di daftar chat.
Tidak ada fallback pengiriman kedua ketika hasil percobaan pertama belum jelas.

1. Pilih akun pengirim pada dropdown Outbound, lalu klik **Kirim DM**. Pilih penerima sesuai kuota,
   pilih template atau tulis pesan, dan periksa pesan hasil personalisasi pada langkah **Tinjau**.
   Tekan **Masukkan ke antrean**. Marketing maupun Admin langsung menyiapkan antrean tanpa
   persetujuan terpisah. Mode API lama `submit` juga masuk antrean setelah konfirmasi pengirim.
2. Di panel **Status pengiriman → Pasang extension / bantuan pengiriman**, unduh SMGE Toolkit, ekstrak ZIP dan pasang folder melalui
   **Load unpacked** pada `chrome://extensions` atau `edge://extensions` dengan Developer mode aktif.
3. Login TikTok di browser yang sama sebagai akun pengirim. Pastikan tautan Profil akun login tersedia
   di navigasi TikTok; bila tak bisa diverifikasi, extension akan berhenti.
4. Batch dari **Kirim DM** sudah masuk antrean. Untuk draft atau tugas lama yang masih menunggu
   review, gunakan **Masukkan pesan ke antrean** pada panel Status pengiriman atau buka pesannya
   dan tekan **Masukkan ke antrean**. Maksimal 30 tugas per batch; data tetap dibatasi pemilik.
5. Dari tab Outbound tersebut, buka extension **SMGE Toolkit**, pilih **Kirim DM**, centang persetujuan pengiriman,
   lalu klik **Mulai**. Berikan izin akses ke origin dashboard bila diminta. Biarkan tab dashboard
   tetap terbuka dan login. Extension membuka tab TikTok untuk memproses satu penerima per putaran.
6. Hasil muncul di panel dan diperbarui setiap 5 detik. Extension mengambil tugas berikutnya melalui
   alarm setiap 30 detik; hanya satu pengiriman aktif per akun pada server.

Batch baru disimpan dalam satu transaksi: bila kuota berubah atau salah satu penerima tidak lagi layak,
seluruh batch dibatalkan. ID permintaan membuat pengulangan request dengan isi yang sama mengembalikan
hasil sebelumnya, tanpa menggandakan tugas. Batch tidak memasukkan tugas disetujui lain yang tidak dipilih.
Personalisasi mengganti `{{nama}}`, `{{username}}`, dan `{{akun}}` sesuai penerima/pengirim.
`{{link}}` memakai link registrasi yang sudah dikonfigurasi; jika kosong, masukkan URL lengkap.
URL ditulis langsung seperti `https://example.com/daftar`, tanpa kurung kurawal. Link yang terlanjur
dibungkus kurung kurawal dibersihkan. Variabel yang tidak dikenal atau belum tersedia ditolak
sebelum pesan masuk antrean. Follow-up menampilkan pratinjau pesan yang sudah dipersonalisasi. Menyiapkan antrean belum berarti DM terkirim.

**Jangan menekan konfirmasi terkirim manual sebagai cara memulai pengiriman.** Itu hanya pencatatan
operator. Tugas yang sudah tercatat `MANUALLY_SENT` tidak dikirim ulang. Bila sebelumnya salah
mengonfirmasi tanpa mengirim, periksa TikTok dan selesaikan pencatatan tugas lama sebelum menyiapkan
tugas baru; modul ini tidak mengubah atau mengirim ulang catatan lama secara otomatis.

## Follow-up TikTok

Aplikasi tidak menyinkronkan balasan TikTok otomatis. Catatan balasan tidak menjadi syarat follow-up:
DM TikTok tidak diblokir karena belum ada catatan balasan, jeda 24 jam, atau jumlah pesan tanpa balasan.
Tidak ada penjadwalan follow-up. Tanggal lama diabaikan oleh antrean dan pengiriman, tidak ditampilkan
di halaman atau timeline, serta dibersihkan saat tugas masuk antrean. Parameter tanggal dari klien
lama tetap diterima tetapi tidak digunakan; follow-up baru menyimpan tanggal kosong.
Kanal selain TikTok tetap memakai aturan izin komunikasi dan batas pesan yang sudah ada.

1. Dari hasil terkirim atau tab **Sudah dikirim**, buka pesan lalu klik **Buat follow-up**.
2. Isi pesan baru lalu klik **Masukkan follow-up ke antrean**. Tidak perlu tanggal/jam atau persetujuan Admin.
3. Mulai extension untuk mengirim. Antrean tetap memeriksa kepemilikan, larangan kontak, status prospek,
   identitas pengirim/penerima, percobaan aktif, dan hasil yang belum pasti sebelum mengirim.
4. Marketing memakai daftar **Sudah dikirim** tanpa status menunggu balasan. Riwayat dan catatan balasan
   manual yang sudah ada tetap tersimpan; data tidak diubah menjadi seolah-olah sudah dibalas.

Slot pengiriman browser dipakai kembali untuk follow-up yang sudah disetujui; snapshot hasil sebelumnya
disimpan dalam audit, dan tiap pesan tercatat sebagai aktivitas prospek. Nomor percobaan baru memastikan
laporan pengiriman lama tidak menggandakan hitungan follow-up. Tampilan Status pengiriman menunjukkan
percobaan terakhir per tugas, sedangkan riwayat pesan tetap tersimpan pada aktivitas prospek.

## Arti hasil

### Extension menampilkan error akses dashboard

Gunakan SMGE Toolkit **1.0.0** atau lebih baru. Versi 0.1.0 salah menangani respons sukses kosong
saat antrean belum ada dan dapat menampilkan pesan login yang keliru. Unduh ulang ZIP dari panel,
ekstrak, lalu ganti/reload extension melalui halaman Extensions. Memuat ulang dashboard saja tidak
memperbarui kode extension.

Jika panel mengatakan belum ada antrean, setujui tugas lalu klik **Antrekan tugas disetujui** sebelum
klik Mulai di extension. Tugas **Dikonfirmasi operator** tidak diantrekan ulang. Sesi yang kedaluwarsa
dicoba diperbarui sekali; jika tetap gagal, extension meminta login ulang. Error CSRF, koneksi, dan
respons bukan JSON ditampilkan terpisah. Tidak ada percobaan ulang pengiriman pesan akibat perbaikan ini.

### Hanya membuka Messages atau gagal mengenali penerima

Membuka `/messages` belum berarti percakapan penerima yang dituju sudah terpilih. Bandingkan
username di header chat dengan penerima tugas. Extension berhenti sebelum mengisi pesan bila
identitas chat belum cocok/dikenali; tab terbuka belum menunjukkan pengiriman berhasil.

Alat **Diagnostik chat** di SMGE Toolkit menyediakan tombol **Unduh diagnostik chat TikTok**. Unduh ulang ZIP, ekstrak
ke folder extension dan Reload di halaman Extensions. Buka tab chat TikTok yang gagal,
buka popup extension dari tab itu lalu pilih diagnostik. File JSON berisi tag, penanda `data-e2e`,
role, class, posisi elemen, rantai parent, placeholder, dan username profil yang terlihat. File tidak
memuat isi pesan, HTML lengkap, nilai editor, cookie, password, token, atau isi storage. Pemeriksaan
ini hanya membaca halaman: tidak memilih chat, mengetik, atau mengirim pesan.

Gunakan file diagnostik untuk menyesuaikan selector berdasarkan DOM yang nyata. Pemeriksaan penerima
dan akun pengirim tetap diperlukan; jangan menghapusnya untuk memaksa klik kirim pada chat terakhir.

| Hasil               | Makna                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menunggu extension  | Tugas sudah tersimpan; tombol kirim belum ditekan.                                                                                                                                                       |
| Diproses            | Satu client memiliki percobaan aktif, maksimal 2 menit.                                                                                                                                                  |
| Terlihat terkirim   | Setelah klik kirim, pesan baru terlihat stabil pada chat penerima dan editor kosong. Ini observasi browser, bukan konfirmasi API, jaminan pesan sampai, atau bukti dibaca. Tugas menjadi `BROWSER_SENT`. |
| Gagal               | Tidak dapat memulai/melakukan pengiriman, misalnya identitas tidak cocok atau tombol pesan tidak tersedia. Tidak menambah hitungan terkirim.                                                             |
| Belum terverifikasi | Tombol mungkin sudah ditekan atau proses terputus. Tidak dicoba ulang otomatis dan akun diblokir dari klaim selanjutnya sampai diperiksa.                                                                |
| Dibatalkan          | Tugas menunggu dibatalkan; percobaan yang sudah berjalan tetap harus dilaporkan.                                                                                                                         |

Untuk hasil belum terverifikasi, buka chat TikTok lalu pilih konfirmasi **Sudah diperiksa** yang sesuai.
Konfirmasi manual terkirim dicatat sebagai `MANUALLY_SENT`, bukan bukti otomatis dari browser.
Tombol Hentikan pada extension berhenti setelah percobaan aktif; tidak membatalkan pesan yang sudah diklik.
Tombol Batalkan antrean dashboard hanya membatalkan tugas yang belum diklaim.

Untuk hasil **Gagal**, tombol **Antrekan ulang** tersedia di tiap baris. Periksa chat dan konfirmasi
pesan belum terkirim terlebih dahulu. Tugas/akun/DNC diperiksa kembali, lalu dibuat attempt baru
dengan audit percobaan sebelumnya. Tidak ada retry otomatis; status terkirim, diproses, dan belum
terverifikasi tidak bisa langsung diantrekan ulang. Tugas yang sudah kehilangan persetujuan juga ditolak.

## Ketahanan dan pembatasan

- Status tersimpan pada tabel `browser_dm_deliveries`, relasi unik per tugas; task lama tidak diantrekan
  dua kali. Klaim dikunci per akun di PostgreSQL. Hasil dan hitungan terkirim diperbarui dalam transaksi.
- Pelaporan hasil idempoten untuk client dan attempt yang sama. Setelah worker terputus, hanya laporan
  hasil yang dicoba kembali; tindakan klik kirim tidak diulang. Percobaan tanpa hasil jelas menjadi
  `UNVERIFIED`; diperlukan pemeriksaan manusia sebelum akun dapat melanjutkan.
- DNC, akun aktif, isi pesan disetujui, dan username diperiksa lagi sebelum klik kirim. Aksi manual
  atas tugas ditahan saat antrean browser masih berjalan/belum jelas.
- Antrean dipisahkan menurut pengguna pembuat. Login dashboard, izin `outreach:work`, CSRF, dan
  pencocokan attempt diperlukan. Extension menjalankan fetch pada tab dashboard yang login;
  token sesi tidak diekspor. Jangan tutup tab dashboard selama percobaan.
- Satu klik kirim tidak menjamin penerima boleh menerima DM. Verifikasi, pembatasan, atau selector
  yang tidak cocok menghentikan antrean; tidak ada bypass, rotasi akun, atau retry pesan otomatis.
- Selector di `infrastructure/smge-extension/page.js` sengaja mensyaratkan identitas akun di navigasi
  dan tautan username penerima di header chat. Bila layout TikTok berbeda, perlu inspeksi dan
  penyesuaian selector; jangan melepas pengecekan identitas agar script sekadar menekan tombol.
- Catatan aktivitas dan audit memisahkan observasi browser dari konfirmasi operator. Data hasil browser
  bukan receipt terverifikasi dari API TikTok.

## Pengembangan

Migration `20261019100000_browser_dm` menambah enum status, tabel antrean, dan status task `BROWSER_SENT`.
Tidak mengubah status pesan yang sudah ada. Setelah deploy, jalankan migrasi, generate Prisma client,
dan restart API agar model baru tersedia. Di Windows, hentikan proses API sebelum generate bila DLL
Prisma sedang dikunci proses Node.

```powershell
node --test infrastructure/smge-extension/page.test.mjs
node --test infrastructure/smge-extension/worker.test.mjs
node --test infrastructure/smge-extension/transport.test.mjs
node --test infrastructure/smge-extension/new-layout.test.mjs
node --test infrastructure/smge-extension/native-input.test.mjs
node --test infrastructure/smge-extension/native-browser.test.mjs
pnpm --filter @smge/api test:e2e --testPathPattern browser-dm
node infrastructure/scripts/package-extension.mjs
```

Endpoint di bawah `/api/outbound/browser-dm`: `GET ?accountId=...`, `POST queue`, `POST claim`,
`POST cancel`, `POST :id/authorize`, `POST :id/result`, `POST :id/resolve`, dan `POST :id/retry`
(body `{ confirmedNotSent: true }`).

Tes otomatis menggunakan halaman fixture dan database test, tidak mengirim DM TikTok sungguhan.
Uji awal pada akun/penerima uji yang Anda kendalikan sebelum mengandalkan selector untuk pengiriman.

Referensi runtime extension: [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger),
[izin yang tidak bisa opsional](https://developer.chrome.com/docs/extensions/reference/api/permissions),
[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
dan [siklus service worker Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
