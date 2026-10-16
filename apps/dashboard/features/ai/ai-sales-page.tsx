'use client';

import { PERMISSIONS } from '@smge/shared';
import { BarChart3, BookOpen, MessagesSquare, Settings2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/hooks/use-auth';
import { AiStatusBanner } from './ai-common';
import { useAiStatus } from './api';
import { AssistantTab } from './assistant-tab';
import { KnowledgeTab } from './knowledge-tab';
import { AiSettingsTab } from './settings-tab';
import { UsageTab } from './usage-tab';

export function AiSalesPage() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const status = useAiStatus();
  const s = status.data;

  const tabs = [
    { value: 'assistant', label: 'Asisten', icon: MessagesSquare, show: true },
    { value: 'knowledge', label: 'Knowledge Base', icon: BookOpen, show: true },
    {
      value: 'usage',
      label: 'Penggunaan & biaya',
      icon: BarChart3,
      show: can(PERMISSIONS.ANALYTICS_READ),
    },
    {
      value: 'settings',
      label: 'Pengaturan AI',
      icon: Settings2,
      show: can(PERMISSIONS.SETTINGS_MANAGE),
    },
  ].filter((t) => t.show);
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.value === requested) ? requested! : 'assistant';

  return (
    <>
      <PageHeader
        title="AI Sales Agent"
        description="Asisten AI untuk menjelaskan Solid Mini berdasarkan Knowledge Base resmi. Mode Copilot: AI memberi saran, operator yang memutuskan dan mengirim."
        actions={
          s && (
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={s.configured ? (s.simulated ? 'simulation' : 'success') : 'secondary'}
              >
                {s.configured
                  ? s.simulated
                    ? 'Simulasi'
                    : `Aktif · ${s.model}`
                  : 'Belum dikonfigurasi'}
              </Badge>
              <Badge variant="outline">{s.publishedDocuments} dokumen KB terbit</Badge>
            </div>
          )
        }
      />
      <AiStatusBanner status={s} />
      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(`/ai-sales?tab=${v}`, { scroll: false })}
      >
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon /> {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="assistant">
          <AssistantTab disabled={!s?.configured} />
        </TabsContent>
        <TabsContent value="knowledge">
          <KnowledgeTab />
        </TabsContent>
        {can(PERMISSIONS.ANALYTICS_READ) && (
          <TabsContent value="usage">
            <UsageTab status={s} />
          </TabsContent>
        )}
        {can(PERMISSIONS.SETTINGS_MANAGE) && (
          <TabsContent value="settings">
            <AiSettingsTab status={s} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
