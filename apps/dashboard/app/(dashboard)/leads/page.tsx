import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'CRM / Prospek' };

export default function Page() {
  return (
    <ComingSoon
      title="CRM / Prospek"
      description="Database terpusat seluruh calon pengguna Solid Mini."
      phase={2}
      icon="Users"
      features={[
        'Status prospek NEW s.d. DO_NOT_CONTACT',
        'Deteksi duplikasi (username, email, telepon)',
        'Pengelolaan izin komunikasi per kanal',
        'Daftar larangan kontak',
        'Import & export sesuai izin',
        'Riwayat aktivitas & segmentasi',
      ]}
      notes="Mengikuti akun TikTok tidak dianggap sebagai persetujuan menerima promosi."
    />
  );
}
