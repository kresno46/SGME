import { ComingSoon } from '@/components/guards';

export const metadata = { title: 'AI Sales Agent' };

export default function Page() {
  return (
    <ComingSoon
      title="AI Sales Agent"
      description="Asisten AI untuk menjelaskan Solid Mini dan membantu operator."
      phase={3}
      icon="Bot"
      features={[
        'Knowledge Base yang dapat diperbarui admin',
        'Mode Copilot (saran, butuh persetujuan)',
        'Mode Auto-Reply hanya pada kanal resmi yang mengizinkan',
        'Lead scoring & ringkasan percakapan',
        'Monitoring token dan biaya API',
        'Human handoff',
      ]}
      notes="AI hanya menjawab berdasarkan Knowledge Base dan tidak boleh membuat klaim palsu atau menjanjikan keuntungan."
    />
  );
}
