import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'Campaign' };

export default function Page() {
  return (
    <ComingSoon
      title="Campaign"
      description="Kelola seluruh aktivitas pemasaran Jalur A dan Jalur B."
      phase={2}
      icon="Megaphone"
      features={[
        'Tujuh jenis campaign (Awareness s.d. Follow-up berizin)',
        'Status Draft, Terjadwal, Aktif, Dijeda, Selesai, Diarsipkan',
        'Penugasan akun TikTok & operator',
        'Anggaran dan biaya aktual',
        'Link tracking unik per campaign',
        'Tabel dengan pencarian, filter, dan pagination',
      ]}
    />
  );
}
