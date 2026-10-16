'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  KNOWLEDGE_STATUSES,
  knowledgeDocumentSchema,
  PERMISSIONS,
  type KnowledgeCategory,
  type KnowledgeDocumentInput,
  type KnowledgeStatus,
} from '@smge/shared';
import type { KnowledgeDocumentDto } from '@smge/types';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
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
  Badge,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { api, applyServerErrors } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { ClaimWarning } from './ai-common';
import { useKnowledge } from './api';

const ALL = '__all__';
const STATUS_VARIANT: Record<KnowledgeStatus, 'success' | 'secondary' | 'outline'> = {
  PUBLISHED: 'success',
  DRAFT: 'outline',
  ARCHIVED: 'secondary',
};

export function KnowledgeTab() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.KNOWLEDGE_MANAGE);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<KnowledgeDocumentDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocumentDto | null>(null);
  const q = useKnowledge({
    page,
    search: useDebounce(search) || undefined,
    category: category === ALL ? undefined : category,
  });

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari judul atau isi…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari dokumen"
          />
        </div>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="md:w-56" aria-label="Filter kategori">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua kategori</SelectItem>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {KNOWLEDGE_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Dokumen baru
          </Button>
        )}
      </div>
      <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Hanya dokumen berstatus <strong>Dipublikasikan</strong> yang dipakai AI. Isi dengan
        informasi resmi Solid Mini; AI tidak akan menyampaikan fakta produk di luar dokumen ini.
      </p>
      {q.isPending ? (
        <TableSkeleton cols={4} />
      ) : !q.data?.items.length ? (
        <EmptyState
          icon={BookOpen}
          title="Knowledge Base masih kosong"
          description="Tambahkan profil produk, fitur, cara daftar & instalasi, FAQ, harga, syarat & ketentuan, dan kebijakan privasi."
          action={
            canManage && (
              <Button onClick={() => setEditing('new')}>
                <Plus /> Tambah dokumen pertama
              </Button>
            )
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Judul</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Versi</TableHead>
                <TableHead>Diperbarui</TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <p className="font-medium">{d.title}</p>
                    <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">
                      {d.content}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {KNOWLEDGE_CATEGORY_LABELS[d.category as KnowledgeCategory] ?? d.category}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.status]}>
                      {KNOWLEDGE_STATUS_LABELS[d.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">v{d.version}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(d.updatedAt)}
                    {d.updatedBy && <span className="block text-xs">{d.updatedBy.name}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={canManage ? 'Edit' : 'Lihat'}
                        onClick={() => setEditing(d)}
                      >
                        {canManage ? <Pencil /> : <BookOpen />}
                      </Button>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Hapus"
                          onClick={() => setDeleting(d)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
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
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing === 'new' ? 'Dokumen baru' : canManage ? 'Edit dokumen' : 'Dokumen'}
            </DialogTitle>
            <DialogDescription>
              Tulis fakta yang jelas dan resmi. Perubahan isi menaikkan nomor versi dan langsung
              dipakai AI bila dipublikasikan.
            </DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <KnowledgeForm
              doc={editing === 'new' ? null : editing}
              readOnly={!canManage}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        destructive
        title="Hapus dokumen?"
        description="Dokumen tidak lagi dipakai AI. Untuk menyimpan riwayat, ubah status menjadi Diarsipkan."
        confirmLabel="Hapus"
        onConfirm={async () => {
          await api.delete(`/knowledge-documents/${deleting!.id}`);
          toast.success('Dokumen dihapus');
          await qc.invalidateQueries({ queryKey: ['ai'] });
        }}
      />
    </Card>
  );
}

type FormInput = z.input<typeof knowledgeDocumentSchema>;

function KnowledgeForm({
  doc,
  readOnly,
  onDone,
}: {
  doc: KnowledgeDocumentDto | null;
  readOnly: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, z.output<typeof knowledgeDocumentSchema>>({
    resolver: zodResolver(knowledgeDocumentSchema),
    defaultValues: {
      title: doc?.title ?? '',
      category: (doc?.category as KnowledgeDocumentInput['category']) ?? 'FAQ',
      content: doc?.content ?? '',
      status: doc?.status ?? 'DRAFT',
    },
  });
  const content = useWatch({ control: form.control, name: 'content' }) ?? '';
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (doc) await api.patch(`/knowledge-documents/${doc.id}`, values);
      else await api.post('/knowledge-documents', values);
      toast.success('Dokumen disimpan');
      await qc.invalidateQueries({ queryKey: ['ai'] });
      onDone();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      <FormField label="Judul" htmlFor="kb-title" error={errors.title?.message}>
        <Input id="kb-title" disabled={readOnly} {...form.register('title')} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Kategori">
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {KNOWLEDGE_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField label="Status">
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={readOnly}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {KNOWLEDGE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>
      <FormField
        label="Isi"
        htmlFor="kb-content"
        error={errors.content?.message}
        hint={`${content.length.toLocaleString('id-ID')} / 20.000 karakter`}
      >
        <Textarea
          id="kb-content"
          rows={14}
          disabled={readOnly}
          className="font-mono text-xs leading-relaxed"
          {...form.register('content')}
        />
      </FormField>
      <ClaimWarning text={content} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {readOnly ? 'Tutup' : 'Batal'}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            Simpan
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
