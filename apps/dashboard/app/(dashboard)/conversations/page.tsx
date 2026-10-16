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
      notes="Inbox hanya untuk kanal pesan yang terhubung melalui API resmi. Menunggu akses TikTok Business Messaging API yang dokumentasi resminya dapat diverifikasi. Sementara itu, balasan prospek dicatat lewat Outbound Workstation dan saran balasan tersedia di AI Sales Agent."
    />
  );
}
