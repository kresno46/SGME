import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'Analitik' };

export default function Page() {
  return (
    <ComingSoon
      title="Analitik"
      description="Pengukuran efektivitas pemasaran hingga registrasi dan aktivasi."
      phase={5}
      icon="BarChart3"
      features={[
        'Funnel konversi (kunjungan → aktivasi)',
        'UTM & link campaign unik',
        'Atribusi first-touch dan last-touch',
        'Cost per lead / registrasi / pengguna aktif',
        'Perbandingan Jalur A vs Jalur B',
        'Produktivitas operator & biaya AI',
      ]}
      notes="Klik link tidak dihitung sebagai instalasi. Data aktual, input manual, dan simulasi selalu dipisahkan."
    />
  );
}
