'use client';

import { INTEREST_LEVEL_LABELS, PERMISSIONS } from '@smge/shared';
import type { AiLeadScoreDto, AiSummaryDto } from '@smge/types';
import { Gauge, Loader2, ScrollText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { AiResultFooter, useAiReady } from './ai-common';
import { useLeadScore, useLeadSummary } from './api';

/** Kartu analisis AI di halaman detail prospek. Hasil juga tercatat di riwayat aktivitas. */
export function LeadAiCard({ leadId }: { leadId: string }) {
  const { can } = useAuth();
  const { allowed, ready, status } = useAiReady();
  const score = useLeadScore(leadId);
  const summary = useLeadSummary(leadId);
  const [scoreResult, setScoreResult] = useState<AiLeadScoreDto | null>(null);
  const [summaryResult, setSummaryResult] = useState<AiSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-text" /> Analisis AI
        </CardTitle>
        <CardDescription>
          {ready
            ? 'Hanya nama panggilan & riwayat interaksi yang dikirim ke AI — tanpa email, telepon, atau username.'
            : (status?.notReadyReason ?? 'AI belum aktif.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {can(PERMISSIONS.LEADS_MANAGE) && (
            <Button
              size="sm"
              variant="outline"
              disabled={!ready || score.isPending}
              onClick={() => {
                setError(null);
                score.mutate(undefined, {
                  onSuccess: setScoreResult,
                  onError: (e) => setError(e.message),
                });
              }}
            >
              {score.isPending ? <Loader2 className="animate-spin" /> : <Gauge />} Skor prospek
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || summary.isPending}
            onClick={() => {
              setError(null);
              summary.mutate(undefined, {
                onSuccess: setSummaryResult,
                onError: (e) => setError(e.message),
              });
            }}
          >
            {summary.isPending ? <Loader2 className="animate-spin" /> : <ScrollText />} Ringkas
            riwayat
          </Button>
        </div>
        <FormError message={error} />
        {scoreResult && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-semibold tabular-nums">{scoreResult.score}</span>
              <span className="text-muted-foreground">
                / 100 · saran ketertarikan: {INTEREST_LEVEL_LABELS[scoreResult.interestLevel]}
              </span>
            </div>
            <ul className="list-disc pl-5 text-muted-foreground">
              {scoreResult.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p>
              <strong>Rekomendasi:</strong> {scoreResult.recommendedAction}
            </p>
            <AiResultFooter meta={scoreResult} />
          </div>
        )}
        {summaryResult && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <p>{summaryResult.summary}</p>
            {summaryResult.keyPoints.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {summaryResult.keyPoints.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            )}
            <p>
              <strong>Langkah berikutnya:</strong> {summaryResult.nextStep}
            </p>
            <AiResultFooter meta={summaryResult} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
