'use client';

import type { AuditLogDto, Paginated } from '@smge/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, Pagination, TableSkeleton } from '@/components/common';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useDebounce } from '@/hooks/use-debounce';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Login',
  'auth.login_failed': 'Login gagal',
  'auth.account_locked': 'Akun dikunci',
  'auth.logout': 'Logout',
  'auth.refresh_token_reuse': 'Indikasi pencurian sesi',
  'auth.session_revoked': 'Sesi diakhiri',
  'auth.password_changed': 'Ganti password',
  'auth.password_reset_requested': 'Permintaan reset password',
  'auth.password_reset': 'Reset password',
  'auth.2fa_enabled': '2FA diaktifkan',
  'auth.2fa_disabled': '2FA dinonaktifkan',
  'user.created': 'Pengguna dibuat',
  'user.updated': 'Pengguna diubah',
  'user.password_reset_by_admin': 'Password diatur ulang admin',
  'user.unlocked': 'Kunci akun dibuka',
  'user.2fa_reset_by_admin': '2FA direset admin',
  'tiktok_account.created': 'Akun TikTok ditambahkan',
  'tiktok_account.updated': 'Akun TikTok diubah',
  'tiktok_account.deleted': 'Akun TikTok dihapus',
};

export function AuditCard() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const q = useQuery({
    queryKey: ['audit-logs', { page, search: debounced }],
    queryFn: () =>
      api.get<Paginated<AuditLogDto>>('/audit-logs', { page, pageSize: 25, search: debounced }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log audit</CardTitle>
        <CardDescription>
          Jejak aktivitas penting. Data sensitif (password, token, kode) selalu disensor.
        </CardDescription>
      </CardHeader>
      <div className="border-y p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari email aktor, aksi, atau ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari log audit"
          />
        </div>
      </div>
      {q.isPending ? (
        <TableSkeleton cols={4} />
      ) : !q.data?.items.length ? (
        <EmptyState title="Belum ada log" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Waktu</TableHead>
                <TableHead>Aktor</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {l.actorEmail ?? <span className="text-muted-foreground">Sistem / anonim</span>}
                    {l.ipAddress && (
                      <p className="text-xs text-muted-foreground">IP {l.ipAddress}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ACTION_LABELS[l.action] ?? l.action}
                    <p className="font-mono text-xs text-muted-foreground">{l.action}</p>
                  </TableCell>
                  <TableCell className="max-w-md">
                    {l.metadata ? (
                      <code
                        className="line-clamp-2 text-xs break-all text-muted-foreground"
                        title={JSON.stringify(l.metadata)}
                      >
                        {JSON.stringify(l.metadata)}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
    </Card>
  );
}
