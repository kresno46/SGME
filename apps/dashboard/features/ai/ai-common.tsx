'use client';

import { detectProhibitedClaims } from '@smge/shared';
import type { AiResultMeta, AiStatusDto } from '@smge/types';
import { AlertTriangle, BookOpen, Bot, FlaskConical, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@smge/shared';
import { useAiStatus } from './api';

export const formatUsd = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : `US$${v.toLocaleString('id-ID', { minimumFractionDigits: v > 0 && v < 0.01 ? 4 : 2, maximumFractionDigits: 4 })}`;

/** Label wajib pada setiap keluaran AI: model, simulasi, sumber KB, token & biaya. */
export function AiResultFooter({ meta }: { meta: AiResultMeta }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {meta.simulated ? (
        <Badge variant="simulation">
          <FlaskConical /> SIMULASI — bukan jawaban model sungguhan
        </Badge>
      ) : (
        <Badge variant="outline">
          <Bot /> {meta.model}
        </Badge>
      )}
      {meta.sources.map((s) => (
        <Badge key={s.id} variant="secondary" title="Sumber Knowledge Base">
          <BookOpen /> {s.title}
        </Badge>
      ))}
      {meta.interactionId && (
        <span>
          {meta.usage.promptTokens + meta.usage.completionTokens} token
          {meta.usage.costUsd !== null && !meta.simulated && ` · ${formatUsd(meta.usage.costUsd)}`}
        </span>
      )}
    </div>
  );
}

export function HandoffNotice({ reason }: { reason: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
      <UserRound className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">Sebaiknya ditangani manusia</p>
        {reason && <p className="text-muted-foreground">{reason}</p>}
      </div>
    </div>
  );
}

/** Peringatan langsung saat teks (ditulis operator/AI) mengandung klaim terlarang. */
export function ClaimWarning({ text }: { text: string }) {
  const claims = detectProhibitedClaims(text);
  if (!claims.length) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Hindari klaim terlarang: {claims.map((c) => `${c.label} ("${c.match}")`).join('; ')}
      </span>
    </div>
  );
}

/** Banner status AI: belum dikonfigurasi / mode simulasi / KB kosong. */
export function AiStatusBanner({ status }: { status: AiStatusDto | undefined }) {
  const { can } = useAuth();
  if (!status) return null;
  if (!status.configured) {
    return (
      <div className="mb-4 rounded-lg border border-dashed p-4 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Bot className="size-4" /> AI belum aktif
        </p>
        <p className="mt-1 text-muted-foreground">
          {status.notReadyReason} Fitur lain tetap dapat dipakai; Knowledge Base bisa disiapkan dari
          sekarang.
        </p>
      </div>
    );
  }
  return (
    <>
      {status.simulated && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-warning bg-warning/10 p-4 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Mode SIMULASI.</strong> Jawaban AI adalah contoh tetap untuk mencoba alur, bukan
            dari model sungguhan. Jangan kirimkan ke calon pengguna.
          </p>
        </div>
      )}
      {status.publishedDocuments === 0 && (
        <div className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          Knowledge Base belum memiliki dokumen yang dipublikasikan, sehingga AI tidak boleh
          menjawab pertanyaan tentang produk.{' '}
          {can(PERMISSIONS.KNOWLEDGE_MANAGE) && (
            <Link
              href="/ai-sales?tab=knowledge"
              className="font-medium text-brand-text hover:underline"
            >
              Tambahkan dokumen →
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** Hook ringkas: apakah tombol AI boleh ditampilkan aktif. */
export function useAiReady() {
  const { can } = useAuth();
  const status = useAiStatus();
  const allowed = can(PERMISSIONS.AI_USE);
  return { allowed, ready: allowed && !!status.data?.configured, status: status.data };
}
