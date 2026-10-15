'use client';

import { DATA_SOURCE_LABELS, type DataSource } from '@smge/shared';
import {
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Inbox,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/overlays';
import { Badge, Card, Label, Skeleton } from '@/components/ui/primitives';
import { cn, formatNumber } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  loading,
  source,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: React.ReactNode;
  loading?: boolean;
  source?: DataSource | null;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {source && source !== 'ACTUAL' && <DataSourceBadge source={source} />}
        {hint}
      </div>
    </Card>
  );
}

/** Label wajib untuk data yang bukan data aktual (input manual / simulasi). */
export function DataSourceBadge({ source, className }: { source: DataSource; className?: string }) {
  if (source === 'SIMULATED') {
    return (
      <Badge variant="simulation" className={className} title="Data simulasi — bukan data asli">
        <FlaskConical /> {DATA_SOURCE_LABELS.SIMULATED}
      </Badge>
    );
  }
  return (
    <Badge variant={source === 'MANUAL' ? 'secondary' : 'success'} className={className}>
      {DATA_SOURCE_LABELS[source]}
    </Badge>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-14 text-center',
        className,
      )}
    >
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-3 py-3 text-sm sm:flex-row">
      <p className="text-muted-foreground">
        Menampilkan {formatNumber(from)}–{formatNumber(to)} dari {formatNumber(total)} data
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft /> Sebelumnya
        </Button>
        <span className="tabular-nums text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Ya, lanjutkan',
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <div className="space-y-2">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={pending}>Batal</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch {
                // pesan error ditampilkan oleh pemanggil / toast global
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Pembungkus field form: label + kontrol + pesan error. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}
