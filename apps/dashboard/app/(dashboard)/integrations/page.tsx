import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'Integrasi' };

export default function Page() {
  return (
    <ComingSoon
      title="Integrasi"
      description="Koneksi resmi ke TikTok dan backend Solid Mini."
      phase={4}
      icon="Cable"
      features={[
        'TikTok OAuth (Login Kit)',
        'TikTok Business API, Lead Generation, Messaging (sesuai izin)',
        'Webhook tervalidasi & idempotent',
        'Token tersimpan terenkripsi',
        'Status koneksi & log integrasi',
        'Mock Adapter berlabel SIMULASI untuk pengujian',
      ]}
      notes="Endpoint hanya diimplementasikan setelah diverifikasi dari dokumentasi resmi TikTok dan izin akses diperoleh."
    />
  );
}
