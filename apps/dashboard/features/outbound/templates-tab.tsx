'use client';

import {
  LANE_LABELS,
  MARKETING_LANES,
  PERMISSIONS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_PURPOSE_LABELS,
  TEMPLATE_PURPOSES,
  templateSchema,
  type TemplateInput,
} from '@smge/shared';
import type { MessageTemplateDto } from '@smge/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  ConfirmDialog,
  EmptyState,
  FormError,
  FormField,
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
  Switch,
} from '@/components/ui/overlays';
import { Badge, Card, CardContent, Input, Label, Textarea } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { api, applyServerErrors } from '@/lib/api';
import { useInvalidateOutbound, useTemplates } from './api';

const ANY = '__any__';

export function TemplatesTab() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.TEMPLATES_MANAGE);
  const q = useTemplates();
  const invalidate = useInvalidateOutbound();
  const [editing, setEditing] = useState<MessageTemplateDto | null | 'new'>(null);
  const [deleting, setDeleting] = useState<MessageTemplateDto | null>(null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Placeholder:{' '}
          {Object.keys(TEMPLATE_PLACEHOLDERS).map((k) => (
            <code key={k} className="mr-1 rounded bg-muted px-1 text-xs">{`{{${k}}}`}</code>
          ))}
        </p>
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Template baru
          </Button>
        )}
      </div>
      {q.isPending ? (
        <TableSkeleton rows={3} cols={2} />
      ) : !q.data?.length ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Belum ada template"
            description="Template mempercepat penulisan draft pesan yang konsisten."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.map((t) => (
            <Card key={t.id} className={t.isActive ? '' : 'opacity-60'}>
              <CardContent className="grid gap-2 pt-5">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{t.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary">
                        {TEMPLATE_PURPOSE_LABELS[
                          t.purpose as keyof typeof TEMPLATE_PURPOSE_LABELS
                        ] ?? t.purpose}
                      </Badge>
                      <Badge variant="outline">
                        {t.lane ? LANE_LABELS[t.lane] : 'Semua jalur'}
                      </Badge>
                      {!t.isActive && <Badge variant="secondary">Nonaktif</Badge>}
                    </div>
                  </div>
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit template"
                        onClick={() => setEditing(t)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Hapus template"
                        onClick={() => setDeleting(t)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                  {t.content}
                </p>
                <p className="text-xs text-muted-foreground">Dipakai di {t.usageCount} tugas</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Template baru' : 'Edit template'}</DialogTitle>
            <DialogDescription>
              Tulis dengan bahasa natural dan ramah. Jangan menjanjikan keuntungan atau klaim yang
              tidak ada di informasi resmi Solid Mini.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <TemplateForm
              template={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Hapus template?"
        description="Tugas yang memakai template ini tetap tersimpan. Untuk menyembunyikan sementara, nonaktifkan saja."
        confirmLabel="Hapus"
        onConfirm={async () => {
          await api.delete(`/message-templates/${deleting!.id}`);
          toast.success('Template dihapus');
          await invalidate();
        }}
      />
    </div>
  );
}

type FormInput = z.input<typeof templateSchema>;

function TemplateForm({
  template,
  onDone,
}: {
  template: MessageTemplateDto | null;
  onDone: () => void;
}) {
  const invalidate = useInvalidateOutbound();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, z.output<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: template?.name ?? '',
      lane: template?.lane ?? 'OUTBOUND',
      purpose: (template?.purpose as TemplateInput['purpose']) ?? 'INTRODUCTION',
      content: template?.content ?? '',
      isActive: template?.isActive ?? true,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (template) await api.patch(`/message-templates/${template.id}`, values);
      else await api.post('/message-templates', values);
      toast.success('Template disimpan');
      await invalidate();
      onDone();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      <FormField label="Nama" htmlFor="t-name" error={errors.name?.message}>
        <Input id="t-name" {...form.register('name')} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tujuan">
          <Controller
            control={form.control}
            name="purpose"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_PURPOSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {TEMPLATE_PURPOSE_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Jalur">
          <Controller
            control={form.control}
            name="lane"
            render={({ field }) => (
              <Select
                value={field.value || ANY}
                onValueChange={(v) => field.onChange(v === ANY ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Semua jalur</SelectItem>
                  {MARKETING_LANES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LANE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>
      <FormField label="Isi pesan" htmlFor="t-content" error={errors.content?.message}>
        <Textarea
          id="t-content"
          rows={5}
          placeholder="Halo {{nama}}! Aku dari @{{akun}}…"
          {...form.register('content')}
        />
      </FormField>
      <Label className="font-normal">
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          )}
        />
        Aktif
      </Label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Simpan
        </Button>
      </DialogFooter>
    </form>
  );
}
