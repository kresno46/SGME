'use client';

import { FOLLOWER_BATCH_LIMIT, followerBatchSchema, type FollowerBatch } from '@smge/shared';
import type { FollowerImportResultDto, TikTokAccountDto } from '@smge/types';
import { Download, ExternalLink, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { FormError, FormField } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useInvalidateOutbound } from './api';

export function FollowersDialog({
  account,
  onClose,
}: {
  account: TikTokAccountDto;
  onClose: () => void;
}) {
  const [batch, setBatch] = useState<FollowerBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FollowerImportResultDto | null>(null);
  const locked = useRef(false);
  const revision = useRef(0);
  const invalidate = useInvalidateOutbound();

  async function readFile(file?: File) {
    const current = ++revision.current;
    setBatch(null);
    setResult(null);
    setError(null);
    if (!file) {
      setReading(false);
      return;
    }
    setReading(true);
    try {
      if (file.size > 256 * 1024)
        throw new Error('File maksimal 256 KB. Ekspor maksimal 250 username per batch.');
      const parsed = followerBatchSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success)
        throw new Error(`Format file SMGE tidak valid: ${parsed.error.issues[0]?.message}`);

      if (current === revision.current) setBatch(parsed.data);
    } catch (cause) {
      if (current === revision.current)
        setError(
          cause instanceof SyntaxError ? 'File JSON tidak dapat dibaca.' : (cause as Error).message,
        );
    } finally {
      if (current === revision.current) setReading(false);
    }
  }

  async function importBatch() {
    if (locked.current || !batch || result) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.post<FollowerImportResultDto>('/outbound/followers/import', {
        accountId: account.id,
        batch,
      });
      setResult(saved);
      void invalidate();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !locked.current && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ambil followers · @{account.username}</DialogTitle>
          <DialogDescription>
            Pengambilan melalui browser yang Anda login sendiri. Hasil masuk ke CRM dan antrean
            prospek untuk akun pengirim yang dipilih. File boleh berasal dari akun TikTok lain.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Unduh dan ekstrak extension. Buka <code>chrome://extensions</code> atau{' '}
            <code>edge://extensions</code>, aktifkan Developer mode, pilih Load unpacked, lalu pilih
            folder hasil ekstrak.
          </li>
          <li>
            Buka profil @{account.username} di browser, login bila diminta, lalu buka{' '}
            <strong>Followers / Pengikut</strong>.
          </li>
          <li>
            Klik extension SMGE Toolkit, pilih Ambil followers, centang konfirmasi, lalu Mulai. Bisa
            dihentikan kapan saja. Ekspor JSON setelah selesai.
          </li>
          <li>Pilih file JSON di bawah, periksa hasilnya, lalu Simpan ke database.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/downloads/smge-extension.zip?v=1.0.0" download>
              <Download /> Unduh extension
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.tiktok.com/@${account.username}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink /> Buka profil
            </a>
          </Button>
        </div>
        <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          Maksimal {FOLLOWER_BATCH_LIMIT} username per batch, dari daftar yang tampil. Hasil bisa
          parsial dan tidak diverifikasi API TikTok. Sesi browser terpisah dari Login Kit. Simpan
          atau ekspor sebelum refresh tab. Mengikuti akun tidak otomatis berarti memberi izin DM.
        </p>
        <FormError message={error} />
        <FormField label="File hasil pengambilan (.json)" htmlFor="follower-file">
          <Input
            id="follower-file"
            type="file"
            accept=".json,application/json"
            disabled={busy || reading}
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </FormField>
        {reading && (
          <p role="status" className="text-sm">
            Membaca file…
          </p>
        )}
        {batch && !result && (
          <div className="grid gap-2 text-sm">
            <p className="rounded-md bg-muted/30 p-3">
              Followers dari <strong>@{batch.accountUsername}</strong> akan masuk ke antrean akun
              pengirim <strong>@{account.username}</strong>.
            </p>
            <p>
              <strong>{batch.followers.length} baris</strong> dari @{batch.accountUsername}. Diambil{' '}
              {new Date(batch.collectedAt).toLocaleString('id-ID')}.
            </p>
            <p className="text-xs text-muted-foreground">{batch.stopReason}</p>
            <div
              className="max-h-28 overflow-y-auto rounded-md border p-2"
              aria-label="Pratinjau followers"
            >
              {batch.followers.slice(0, 20).map((row, index) => (
                <p key={index}>
                  @{row.username} {row.displayName && `· ${row.displayName}`}
                </p>
              ))}
              {batch.followers.length > 20 && (
                <p>…dan {batch.followers.length - 20} baris lainnya.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Username duplikat, akun sendiri, dan daftar larangan kontak dilewati. Data lama tidak
              ditimpa. Data baru diberi tag tiktok-followers dan tidak ditambahkan izin komunikasi.
            </p>
          </div>
        )}
        {result && (
          <p role="status" className="rounded-md border p-3 text-sm">
            Tersimpan: <strong>{result.created}</strong> prospek baru. Dilewati: {result.existing}{' '}
            sudah ada, {result.blocked} larangan kontak, {result.self} akun sendiri,{' '}
            {result.duplicateRows} baris duplikat. Periksa CRM atau Antrean prospek; belum ada DM
            yang dikirim.
          </p>
        )}
        {account.status !== 'ACTIVE' && (
          <p className="text-sm text-destructive">Aktifkan akun sebelum mengimpor followers.</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Tutup
          </Button>
          <Button
            disabled={!batch || busy || reading || !!result || account.status !== 'ACTIVE'}
            onClick={() => void importBatch()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} Simpan ke database
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
