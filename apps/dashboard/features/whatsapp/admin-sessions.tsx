'use client';

import { ROLE_LABELS } from '@smge/shared';
import type { WhatsappAdminSessionDto } from '@smge/types';
import { LogOut, Power } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, EmptyState, TableSkeleton } from '@/components/common';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAdminSessionAction, useAdminSessions } from './api';
import { SessionStatusBadge } from './status';

/** Super Admin: siapa saja yang menautkan nomor, dengan status langsung dari WAHA. */
export function AdminSessions() {
  const sessions = useAdminSessions(true);
  const stop = useAdminSessionAction('stop');
  const logout = useAdminSessionAction('logout');
  const [target, setTarget] = useState<{
    row: WhatsappAdminSessionDto;
    action: 'stop' | 'logout';
  } | null>(null);

  if (sessions.isLoading) return <TableSkeleton rows={4} cols={5} />;
  const rows = sessions.data ?? [];
  if (rows.length === 0)
    return (
      <Card>
        <EmptyState
          title="Belum ada nomor yang ditautkan"
          description="Marketing menautkan nomornya sendiri di tab Nomor saya."
        />
      </Card>
    );

  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pengguna</TableHead>
            <TableHead>Nama nomor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>No. WhatsApp</TableHead>
            <TableHead className="text-right">Chat</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.sessionId}>
              <TableCell>
                <p className="font-medium">{r.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[r.userRole]} · {r.userEmail}
                  {!r.userActive && ' · nonaktif'}
                </p>
              </TableCell>
              <TableCell className="text-sm font-medium">{r.label}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SessionStatusBadge status={r.status} />
                  {r.connectionLost && <Badge variant="destructive">Terputus</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {r.connectedNumber ?? 'Belum tertaut'}
                {r.connectedName && (
                  <span className="text-muted-foreground"> · {r.connectedName}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.chatCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ row: r, action: 'stop' })}
                  >
                    <Power /> Hentikan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ row: r, action: 'logout' })}
                  >
                    <LogOut /> Putuskan
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={
          target?.action === 'logout'
            ? 'Putuskan nomor pengguna ini?'
            : 'Hentikan sesi pengguna ini?'
        }
        description={
          target?.action === 'logout'
            ? `Nomor "${target.row.label}" milik ${target.row.userName} dilepas dan harus dipindai ulang oleh pemiliknya.`
            : `Sesi "${target?.row.label ?? ''}" milik ${target?.row.userName ?? ''} berhenti sampai pemiliknya memulai lagi.`
        }
        confirmLabel={target?.action === 'logout' ? 'Putuskan' : 'Hentikan'}
        destructive
        onConfirm={() =>
          target?.action === 'logout'
            ? logout.mutateAsync(target.row.sessionId)
            : stop.mutateAsync(target!.row.sessionId)
        }
      />
    </Card>
  );
}
