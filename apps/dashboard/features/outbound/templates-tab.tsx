'use client';

import {
  LANE_LABELS,
  PERMISSIONS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_PURPOSE_LABELS,
  TEMPLATE_PURPOSES,
  templateSchema,
  type TemplateInput,
} from '@smge/shared';
import type { MessageTemplateDto } from '@smge/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { HIDE_OFFICIAL_LANE, VISIBLE_MARKETING_LANES } from '@/lib/marketing-scope';
import { useInvalidateOutbound, useTemplates } from './api';

const ANY = '__any__';

export function TemplatesTab() {
  const { can, user } = useAuth();
  const canManage = can(PERMISSIONS.TEMPLATES_MANAGE);
  const q = useTemplates();
  const invalidate = useInvalidateOutbound();
  const [editing, setEditing] = useState<MessageTemplateDto | null | 'new'>(null);
  const [deleting, setDeleting] = useState<MessageTemplateDto | null>(null);
  const [copying, setCopying] = useState<MessageTemplateDto | null>(null);
  const groups = [
    {
      title: 'Template saya',
      description: 'Template pribadi Anda. Bisa dibuat, diubah, dinonaktifkan, atau dihapus.',
      rows: (q.data ?? []).filter((t) => t.createdBy?.id === user.id),
    },
    {
      title: 'Rekomendasi admin',
      description:
        'Bisa langsung dipakai. Salin ke template saya untuk membuat versi Anda sendiri.',
      rows: (q.data ?? []).filter((t) => !t.createdBy),
    },
    ...(user.role === 'SUPER_ADMIN'
      ? [
          {
            title: 'Template user lain',
            description:
              'Template pribadi milik user lain. Hanya Super Admin yang dapat melihat dan mengelolanya.',
            rows: (q.data ?? []).filter((t) => t.createdBy && t.createdBy.id !== user.id),
          },
        ]
      : []),
  ];
  const closeEditor = () => {
    setEditing(null);
    setCopying(null);
  };

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
      <FormError message={q.error?.message ?? null} />
      {q.isPending ? (
        <TableSkeleton rows={3} cols={2} />
      ) : q.isError ? null : (
        groups.map((group) => (
          <section key={group.title} className="grid gap-3" aria-label={group.title}>
            <div>
              <h2 className="font-semibold">
                {group.title}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  ({group.rows.length})
                </span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            </div>
            {!group.rows.length ? (
              <Card>
                <EmptyState
                  icon={FileText}
                  title={
                    group.title === 'Template saya'
                      ? 'Belum punya template pribadi'
                      : 'Belum ada template'
                  }
                  description={
                    group.title === 'Template saya'
                      ? 'Klik Template baru atau salin salah satu rekomendasi admin.'
                      : undefined
                  }
                />
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {group.rows.map((t) => (
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
                            {!HIDE_OFFICIAL_LANE && (
                              <Badge variant="outline">
                                {t.lane ? LANE_LABELS[t.lane] : 'Semua jalur'}
                              </Badge>
                            )}
                            {!t.isActive && <Badge variant="secondary">Nonaktif</Badge>}
                            <Badge variant="outline">
                              {t.createdBy
                                ? t.createdBy.id === user.id
                                  ? 'Template saya'
                                  : 'Template pribadi'
                                : 'Rekomendasi admin'}
                            </Badge>
                            {user.role === 'SUPER_ADMIN' && t.createdBy && (
                              <span className="text-xs text-muted-foreground">
                                Pemilik: {t.createdBy.name}
                              </span>
                            )}
                          </div>
                        </div>
                        {canManage &&
                          (user.role === 'SUPER_ADMIN' || t.createdBy?.id === user.id) && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Edit template ${t.name}`}
                                onClick={() => setEditing(t)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Hapus template ${t.name}`}
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
                      <p className="text-xs text-muted-foreground">
                        Dipakai di {t.usageCount} tugas
                      </p>
                      {!t.createdBy && canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="justify-self-start"
                          onClick={() => setCopying(t)}
                        >
                          <Copy /> Salin ke template saya
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))
      )}
      <Dialog open={editing !== null || copying !== null} onOpenChange={(o) => !o && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {copying
                ? 'Salin ke template saya'
                : editing === 'new'
                  ? 'Template baru'
                  : 'Edit template'}
            </DialogTitle>
            <DialogDescription>
              {copying
                ? 'Ubah nama atau isi salinan ini sesuai kebutuhan. Rekomendasi admin tetap tersimpan tanpa perubahan.'
                : editing && editing !== 'new' && !editing.createdBy
                  ? 'Rekomendasi ini tersedia untuk semua user. Perubahan di sini memperbarui rekomendasi aslinya.'
                  : 'Template pribadi hanya terlihat oleh pemiliknya dan Super Admin. Tulis pesan dengan bahasa natural dan ramah.'}
            </DialogDescription>
          </DialogHeader>
          {(editing !== null || copying !== null) && (
            <TemplateForm
              template={editing === 'new' ? null : editing}
              copyFrom={copying}
              onDone={closeEditor}
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
  copyFrom,
  onDone,
}: {
  template: MessageTemplateDto | null;
  copyFrom?: MessageTemplateDto | null;
  onDone: () => void;
}) {
  const invalidate = useInvalidateOutbound();
  const [error, setError] = useState<string | null>(null);
  const initial = template ?? copyFrom;
  const form = useForm<FormInput, unknown, z.output<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: copyFrom ? `${copyFrom.name.slice(0, 90)} (salinan)` : (template?.name ?? ''),
      lane: initial?.lane ?? 'OUTBOUND',
      purpose: (initial?.purpose as TemplateInput['purpose']) ?? 'INTRODUCTION',
      content: initial?.content ?? '',
      isActive: copyFrom ? true : (template?.isActive ?? true),
    },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (template) await api.patch(`/message-templates/${template.id}`, values);
      else await api.post('/message-templates', values);
      toast.success(copyFrom ? 'Salinan tersimpan sebagai template pribadi' : 'Template disimpan');
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
        {!HIDE_OFFICIAL_LANE && (
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
                    {VISIBLE_MARKETING_LANES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {LANE_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        )}
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
          {copyFrom ? 'Simpan sebagai template saya' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  );
}
