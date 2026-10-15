import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'Percakapan' };

export default function Page() {
  return (
    <ComingSoon
      title="Percakapan"
      description="Inbox terpusat untuk kanal pesan yang terintegrasi secara resmi."
      phase={4}
      icon="MessagesSquare"
      features={[
        'Daftar percakapan & profil prospek',
        'Saran balasan AI dan balasan manual',
        'Penugasan operator & catatan internal',
        'Tag, pencarian, dan filter',
        'Eskalasi ke manusia',
        'Status OPEN s.d. CLOSED',
      ]}
      notes="Inbox hanya menampilkan kanal yang terhubung melalui API resmi."
    />
  );
}
