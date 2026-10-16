'use client';

import type { AiAnswerDto, AiReplySuggestionDto } from '@smge/types';
import { Copy, Loader2, MessageSquareReply, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
} from '@/components/ui/primitives';
import { useAsk, useReplySuggestion } from './api';
import { AiResultFooter, ClaimWarning, HandoffNotice } from './ai-common';

function CopyButton({ text }: { text: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        toast.success('Disalin');
      }}
    >
      <Copy /> Salin
    </Button>
  );
}

export function AssistantTab({ disabled }: { disabled: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AskCard disabled={disabled} />
      <ReplyCard disabled={disabled} />
    </div>
  );
}

function AskCard({ disabled }: { disabled: boolean }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiAnswerDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = useAsk();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="size-4" /> Tanya Knowledge Base
        </CardTitle>
        <CardDescription>
          Cek jawaban resmi tentang Solid Mini sebelum membalas calon pengguna.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          rows={3}
          placeholder="mis. Bagaimana cara daftar Solid Mini?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Pertanyaan"
        />
        <div>
          <Button
            disabled={disabled || ask.isPending || question.trim().length < 3}
            onClick={() => {
              setError(null);
              ask.mutate(
                { question },
                { onSuccess: setResult, onError: (e) => setError(e.message) },
              );
            }}
          >
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Tanya AI
          </Button>
        </div>
        <FormError message={error} />
        {result && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
            {result.handoff && <HandoffNotice reason={result.handoffReason} />}
            <p className="text-sm whitespace-pre-wrap">{result.answer}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AiResultFooter meta={result} />
              {result.interactionId && <CopyButton text={result.answer} />}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReplyCard({ disabled }: { disabled: boolean }) {
  const [incoming, setIncoming] = useState('');
  const [result, setResult] = useState<AiReplySuggestionDto | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suggest = useReplySuggestion();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareReply className="size-4" /> Saran balasan (Copilot)
        </CardTitle>
        <CardDescription>
          Tempel pesan dari calon pengguna. AI menyarankan balasan; Anda meninjau dan mengirimnya
          sendiri.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          rows={3}
          placeholder="Pesan dari calon pengguna…"
          value={incoming}
          onChange={(e) => setIncoming(e.target.value)}
          aria-label="Pesan masuk"
        />
        <div>
          <Button
            disabled={disabled || suggest.isPending || !incoming.trim()}
            onClick={() => {
              setError(null);
              suggest.mutate(
                { incomingMessage: incoming },
                {
                  onSuccess: (r) => {
                    setResult(r);
                    setDraft(r.reply);
                  },
                  onError: (e) => setError(e.message),
                },
              );
            }}
          >
            {suggest.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Sarankan
            balasan
          </Button>
        </div>
        <FormError message={error} />
        {result && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Maksud terdeteksi: {result.detectedIntent}
            </p>
            {result.handoff && <HandoffNotice reason={result.handoffReason} />}
            <Textarea
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Saran balasan"
            />
            <ClaimWarning text={draft} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AiResultFooter meta={result} />
              <CopyButton text={draft} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
