'use client';

import { CONTACT_CHANNEL_LABELS, PERMISSIONS, type ContactChannel } from '@smge/shared';
import type { DncEntryDto } from '@smge/types';
import { Ban, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ConfirmDialog,
  EmptyState,
  FormError,
  FormField,
  Pagination,
  TableSkeleton,
} from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import {
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useDnc, useInvalidateLeads } from './api';

/** Jenis identitas pada daftar larangan (telepon berlaku juga untuk WhatsApp & SMS). */
const KIND_LABELS: Partial<Record<ContactChannel, string>> = {
  TIKTOK_DM: 'Username TikTok',
  EMAIL: 'Email',
  PHONE: 'Telepon / WA / SMS',
};

export function DncList() {
  const { can } = useAuth();
  const invalidate = useInvalidateLeads();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<DncEntryDto | null>(null);
  const q = useDnc({ page, search: useDebounce(search) || undefined });

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari username, email, atau nomor…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari daftar larangan"
          />
        </div>
        {can(PERMISSIONS.LEADS_MANAGE) && (
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Tambah kontak
          </Button>
        )}
      </div>
      {q.isPending ? (
        <TableSkeleton cols={4} />
      ) : !q.data?.items.length ? (
        <EmptyState
          icon={Ban}
          title="Daftar larangan kontak kosong"
          description="Kontak yang meminta tidak dihubungi akan tercatat di sini dan otomatis dikecualikan dari outbound."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Jenis</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Dicatat</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">
                    {KIND_LABELS[e.channel] ?? CONTACT_CHANNEL_LABELS[e.channel]}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {e.channel === 'TIKTOK_DM' ? `@${e.valueNormalized}` : e.valueNormalized}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.reason ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                    {e.addedBy && <span className="block text-xs">oleh {e.addedBy.name}</span>}
                  </TableCell>
                  <TableCell>
                    {can(PERMISSIONS.DNC_MANAGE) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Hapus dari daftar"
                        onClick={() => setRemoving(e)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={q.data.page}
            totalPages={q.data.totalPages}
            total={q.data.total}
            pageSize={q.data.pageSize}
            onPageChange={setPage}
          />
        </>
      )}
      <AddDncDialog open={addOpen} onOpenChange={setAddOpen} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        title="Hapus dari daftar larangan?"
        description="Hanya lakukan bila ada persetujuan baru yang jelas dari pemilik kontak. Status prospek terkait tidak berubah otomatis — cabut larangan di halaman prospek."
        confirmLabel="Hapus"
        onConfirm={async () => {
          await api.delete(`/do-not-contact/${removing!.id}`);
          toast.success('Entri dihapus');
          await invalidate();
        }}
      />
    </Card>
  );
}

function AddDncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah ke daftar larangan kontak</DialogTitle>
          <DialogDescription>
            Semua prospek dengan kontak ini akan ditandai "jangan dihubungi".
          </DialogDescription>
        </DialogHeader>
        <AddDncForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddDncForm({ onDone }: { onDone: () => void }) {
  const invalidate = useInvalidateLeads();
  const [channel, setChannel] = useState<ContactChannel>('TIKTOK_DM');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ affectedLeads: number }>('/do-not-contact', {
        channel,
        value,
        reason,
      });
      toast.success(
        r.affectedLeads
          ? `Ditambahkan; ${r.affectedLeads} prospek ditandai`
          : 'Ditambahkan ke daftar larangan',
      );
      await invalidate();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <FormError message={error} />
      <FormField label="Jenis kontak">
        <Select value={channel} onValueChange={(v) => setChannel(v as ContactChannel)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABELS) as ContactChannel[]).map((c) => (
              <SelectItem key={c} value={c}>
                {KIND_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Kontak" htmlFor="dnc-value">
        <Input id="dnc-value" value={value} onChange={(e) => setValue(e.target.value)} />
      </FormField>
      <FormField label="Alasan" htmlFor="dnc-reason">
        <Input
          id="dnc-reason"
          placeholder="mis. Membalas STOP"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button disabled={busy || value.trim().length < 2} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" />}
          Tambahkan
        </Button>
      </DialogFooter>
    </div>
  );
}
