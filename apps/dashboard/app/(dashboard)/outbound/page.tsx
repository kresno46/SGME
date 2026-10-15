import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'Outbound Workstation' };

export default function Page() {
  return (
    <ComingSoon
      title="Outbound Workstation"
      description="Ruang kerja operator Jalur B untuk penjangkauan personal yang sah."
      phase={2}
      icon="Send"
      features={[
        'Antrean prospek yang memenuhi syarat per akun',
        'Draft pesan personal oleh AI (Fase 3)',
        'Review & persetujuan pesan',
        'Konfirmasi pengiriman manual oleh operator',
        'Pengingat follow-up',
        'Tracking respons & konversi',
      ]}
      notes="Sistem tidak mengirim DM massal otomatis. Status terkirim hanya diisi setelah operator mengonfirmasi pengiriman."
    />
  );
}
