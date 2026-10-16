'use client';

import type { AiDraftDto, AiReplySuggestionDto } from '@smge/types';
import { Copy, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { AiResultFooter, HandoffNotice, useAiReady } from './ai-common';
import { useOutreachDraft, useReplySuggestion } from './api';

/** Tombol "Buat draft dengan AI" di dialog tugas. Hasil harus diterapkan operator secara eksplisit. */
export function AiDraftHelper({
  taskId,
  onApply,
}: {
  taskId: string;
  onApply: (message: string) => void;
}) {
  const { allowed, ready } = useAiReady();
  const draft = useOutreachDraft();
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState<AiDraftDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Arahan untuk AI (opsional), mis. lebih santai"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          aria-label="Arahan untuk AI"
        />
        <Button
          variant="outline"
          disabled={!ready || draft.isPending}
          title={ready ? undefined : 'AI belum dikonfigurasi'}
          onClick={() => {
            setError(null);
            draft.mutate(
              { taskId, instructions: instructions || null },
              { onSuccess: setResult, onError: (e) => setError(e.message) },
            );
          }}
        >
          {draft.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft dengan AI
        </Button>
      </div>
      <FormError message={error} />
      {result && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
          <p className="whitespace-pre-wrap">{result.message}</p>
          <p className="text-xs text-muted-foreground">{result.rationale}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AiResultFooter meta={result} />
            <Button
              size="sm"
              disabled={result.simulated}
              title={result.simulated ? 'Draft simulasi tidak boleh dipakai' : undefined}
              onClick={() => {
                onApply(result.message);
                setResult(null);
                toast.success('Draft AI dipakai — tinjau sebelum diajukan');
              }}
            >
              Pakai draft ini
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Saran balasan untuk pesan prospek dalam konteks tugas. */
export function AiReplyHelper({ taskId }: { taskId: string }) {
  const { allowed, ready } = useAiReady();
  const suggest = useReplySuggestion();
  const [incoming, setIncoming] = useState('');
  const [result, setResult] = useState<AiReplySuggestionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <p className="text-xs font-medium text-muted-foreground">Saran balasan AI (opsional)</p>
      <Textarea
        rows={2}
        placeholder="Tempel pesan balasan dari prospek…"
        value={incoming}
        onChange={(e) => setIncoming(e.target.value)}
        aria-label="Pesan dari prospek"
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || suggest.isPending || !incoming.trim()}
          onClick={() => {
            setError(null);
            suggest.mutate(
              { incomingMessage: incoming, taskId },
              { onSuccess: setResult, onError: (e) => setError(e.message) },
            );
          }}
        >
          {suggest.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Sarankan balasan
        </Button>
      </div>
      <FormError message={error} />
      {result && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
          {result.handoff && <HandoffNotice reason={result.handoffReason} />}
          <p className="whitespace-pre-wrap">{result.reply}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AiResultFooter meta={result} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(result.reply);
                toast.success('Saran balasan disalin');
              }}
            >
              <Copy /> Salin
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
