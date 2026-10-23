# Sesi login dashboard

Semua role otomatis keluar setelah 30 menit tanpa aktivitas di dashboard. Peringatan muncul pada 60 detik terakhir dengan tombol **Tetap masuk**.

Klik, gerakan pointer, ketikan, scroll, dan sentuhan memperpanjang waktu sesi. Polling data, refresh token, dan proses extension tidak dihitung sebagai aktivitas pengguna. Aktivitas pada salah satu tab dashboard memperpanjang sesi di tab lain untuk pengguna yang sama.

Waktu aktivitas terakhir disimpan di browser. Reload halaman tidak mengulang timer. Setelah laptop sleep atau tab lama tidak aktif, dashboard memeriksa waktu yang sudah lewat sebelum menerima aktivitas baru. Login baru, termasuk verifikasi dua langkah, memulai timer baru.

Saat waktu habis, dashboard menutup tampilan data, memanggil endpoint logout untuk mencabut sesi server, lalu mengarahkan ke login. Logout juga diteruskan ke tab lain. Jika jaringan tidak tersedia, pencabutan sesi server bisa gagal; tampilan dashboard tetap terkunci oleh timer browser dan pengguna diminta login kembali. Saat browser tertutup, logout baru diproses ketika dashboard dibuka kembali. Batas ini adalah timer aktivitas dashboard, bukan pengganti masa berlaku token server.

Konstanta durasi ada di `apps/dashboard/lib/idle-session.ts`. Jika penyimpanan browser tidak tersedia, timer tetap berjalan pada tab yang sedang terbuka, tetapi sinkronisasi antar-tab dan persistensi reload tidak tersedia.
