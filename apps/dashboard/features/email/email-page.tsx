'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { EmptyState, FormError, FormField, PageHeader, StatCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge, Card, Checkbox, Input, Textarea } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

type Recipient = { name: string; email: string };
type Template = { id: string; name: string; subject: string; body: string };
const labels = {
  QUEUED: 'Menunggu',
  PROCESSING: 'Diproses',
  ACCEPTED: 'Diterima server email',
  FAILED: 'Gagal',
  UNVERIFIED: 'Perlu diperiksa',
  CANCELLED: 'Dibatalkan',
};
type Message = {
  id: string;
  recipient: string;
  recipientName: string;
  sender: string;
  subject: string;
  body: string;
  status: keyof typeof labels;
  detail: string | null;
  createdAt: string;
};
const defaults = {
  name: '',
  subject: 'Halo {{nama}}, boleh berbagi informasi?',
  body: 'Halo {{nama}},\n\nSaya ingin berbagi informasi yang mungkin sesuai dengan kebutuhan Anda. Apakah berkenan jika saya jelaskan lebih lanjut?\n\nTerima kasih.\nJika tidak ingin menerima email lagi, silakan balas untuk memberi tahu kami.',
};
function personalize(value: string, recipient: Recipient) {
  return value.replace(/\{\{\s*(nama|email)\s*\}\}/g, (_, key) =>
    key === 'nama' ? recipient.name || recipient.email.split('@')[0] : recipient.email,
  );
}
function parseRecipients(raw: string) {
  const valid = new Map<string, Recipient>();
  const errors: number[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(line);
    const email = (match ? match[2] : line).trim().toLowerCase();
    const name = match?.[1].trim() ?? '';
    if (!z.string().email().max(254).safeParse(email).success || name.length > 100)
      errors.push(index + 1);
    else valid.set(email, { name, email });
  });
  return { recipients: [...valid.values()], errors };
}

export function EmailPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: ['email', 'config'],
    queryFn: () =>
      api.get<{ enabled: boolean; sender: string; maxRecipients: number; dailyLimit: number }>(
        '/email-outreach/config',
      ),
  });
  const history = useQuery({
    queryKey: ['email', 'history', user.id],
    queryFn: () =>
      api.get<{ items: Message[]; counts: Partial<Record<keyof typeof labels, number>> }>(
        '/email-outreach',
      ),
    refetchInterval: 5000,
  });
  const templates = useQuery({
    queryKey: ['email', 'templates', user.id],
    queryFn: () => api.get<Template[]>('/email-outreach/templates'),
  });
  const [tab, setTab] = useState('compose');
  const [raw, setRaw] = useState('');
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);
  const [selected, setSelected] = useState('');
  const [review, setReview] = useState<{
    id: string;
    recipients: Recipient[];
    subject: string;
    body: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<(Omit<Template, 'id'> & { id?: string }) | null>(null);
  const [detail, setDetail] = useState<Message | null>(null);
  const parsed = parseRecipients(raw);
  const sample = parsed.recipients[0] ?? { name: 'Nama penerima', email: 'penerima@example.com' };
  const previewSubject = personalize(subject, sample);
  const previewBody = personalize(body, sample);
  const remainingVariables = /\{\{|\}\}/.test(previewSubject + previewBody);
  const ready =
    parsed.recipients.length > 0 &&
    parsed.recipients.length <= (config.data?.maxRecipients ?? 30) &&
    !parsed.errors.length &&
    !!subject.trim() &&
    subject.length <= 200 &&
    !/[\r\n]/.test(subject) &&
    body.trim().length >= 5 &&
    body.length <= 10000 &&
    !remainingVariables;
  const counts = history.data?.counts;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['email'] });
  async function perform(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await invalidate();
      toast.success(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseTemplate(id: string) {
    setSelected(id);
    const item = templates.data?.find((t) => t.id === id);
    if (item) {
      setSubject(item.subject);
      setBody(item.body);
    }
  }
  async function submit() {
    if (!review || !confirmed || busy) return;
    await perform(async () => {
      await api.post('/email-outreach', {
        requestId: review.id,
        recipients: review.recipients,
        subject: review.subject,
        body: review.body,
        confirmed: true,
      });
      setReview(null);
      setRaw('');
      setTab('history');
    }, 'Email masuk antrean. Pantau hasil di Riwayat pengiriman.');
  }
  return (
    <>
      <PageHeader
        title="Kirim Email"
        description="Pilih penerima, siapkan pesan, lalu pantau pengiriman dari satu halaman."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Dalam antrean"
          value={(counts?.QUEUED ?? 0) + (counts?.PROCESSING ?? 0)}
          icon={Send}
          loading={history.isPending}
          hint="Menunggu atau sedang diproses"
        />
        <StatCard
          label="Diterima server email"
          value={counts?.ACCEPTED ?? 0}
          icon={CheckCircle2}
          loading={history.isPending}
          hint="Belum berarti masuk inbox atau dibaca"
        />
        <StatCard
          label="Perlu diperiksa"
          value={(counts?.FAILED ?? 0) + (counts?.UNVERIFIED ?? 0)}
          icon={AlertTriangle}
          loading={history.isPending}
          hint="Buka riwayat untuk melihat alasannya"
        />
      </div>
      {config.isError ? (
        <FormError message="Status pengirim belum dapat dimuat. Coba muat ulang halaman." />
      ) : (
        config.data &&
        !config.data.enabled && (
          <Card className="mb-5 flex gap-3 border-primary/30 bg-primary/5 p-4">
            <Mail className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Pengiriman email belum aktif</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Anda bisa menyiapkan pesan dan template. Hubungi admin untuk mengaktifkan email
                perusahaan sebelum mengirim.
              </p>
            </div>
          </Card>
        )
      )}
      <FormError message={error} />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setError('');
        }}
      >
        <TabsList className="mb-5">
          <TabsTrigger value="compose">
            <Send /> Tulis email
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText /> Template saya
          </TabsTrigger>
          <TabsTrigger value="history">
            <Mail /> Riwayat pengiriman
          </TabsTrigger>
        </TabsList>
        <TabsContent value="compose">
          <div className="grid items-start gap-5 xl:grid-cols-[1.1fr_1fr]">
            <Card className="space-y-5 p-5">
              <div>
                <h2 className="font-semibold">Penerima dan pesan</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Maksimal 30 penerima per pengiriman. Email duplikat dihitung sekali.
                </p>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm">
                <span className="text-muted-foreground">Dari: </span>
                {config.data?.enabled ? config.data.sender : 'Menunggu pengaturan admin'}
              </div>
              <FormField label="Email penerima" htmlFor="email-recipients">
                <Textarea
                  id="email-recipients"
                  rows={4}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={
                    'Satu penerima per baris:\nBudi <budi@example.com>\nsari@example.com'
                  }
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {parsed.recipients.length} penerima valid · Nama opsional. Gunakan alamat penerima
                  yang bersedia dihubungi.
                </p>
              </FormField>
              {!!parsed.errors.length && (
                <p role="alert" className="text-sm text-destructive">
                  Periksa format penerima pada baris {parsed.errors.join(', ')}.
                </p>
              )}
              {parsed.recipients.length > 30 && (
                <p role="alert" className="text-sm text-destructive">
                  Pilih maksimal 30 penerima.
                </p>
              )}
              <FormField label="Pakai template" htmlFor="email-template">
                <select
                  id="email-template"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={selected}
                  onChange={(e) => chooseTemplate(e.target.value)}
                >
                  <option value="">Tulis pesan sendiri</option>
                  {templates.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Subjek" htmlFor="email-subject">
                <Input
                  id="email-subject"
                  value={subject}
                  maxLength={200}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </FormField>
              <FormField label="Isi email" htmlFor="email-body">
                <Textarea
                  id="email-body"
                  rows={9}
                  maxLength={10000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Gunakan {'{{nama}}'} dan {'{{email}}'} untuk personalisasi. Tempel link langsung
                  tanpa tanda kurung.
                </p>
              </FormField>
              {remainingVariables && (
                <p role="alert" className="text-sm text-destructive">
                  Ada variabel yang belum dikenali. Periksa pratinjau sebelum mengirim.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!ready || !config.data?.enabled || busy}
                  onClick={() => {
                    setError('');
                    setConfirmed(false);
                    setReview({
                      id: crypto.randomUUID(),
                      recipients: parsed.recipients,
                      subject: subject.trim(),
                      body: body.trim(),
                    });
                  }}
                >
                  <Send className="size-4" /> Tinjau & kirim
                </Button>
                <Button variant="outline" onClick={() => setEditing({ name: '', subject, body })}>
                  Simpan sebagai template
                </Button>
              </div>
            </Card>
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Mail className="size-4" />
                <h2 className="font-semibold">Pratinjau email</h2>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">Contoh untuk {sample.email}</p>
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/40 p-4">
                  <p className="break-words font-semibold">{previewSubject || 'Subjek email'}</p>
                  <p className="mt-2 break-words text-xs text-muted-foreground">
                    Kepada: {sample.name ? `${sample.name} <${sample.email}>` : sample.email}
                  </p>
                </div>
                <p className="min-h-56 whitespace-pre-wrap break-words p-4 text-sm leading-relaxed">
                  {previewBody || 'Isi pesan akan tampil di sini.'}
                </p>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Email dikirim satu per satu melalui server. Anda tidak memerlukan extension. Balasan
                dibaca di inbox email perusahaan.
              </p>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="templates">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Template pribadi Anda. Perubahan template tidak mengubah email yang sudah diantrekan.
            </p>
            <Button onClick={() => setEditing({ ...defaults })}>
              <Plus className="size-4" /> Template baru
            </Button>
          </div>
          {templates.isError ? (
            <FormError message="Template belum dapat dimuat." />
          ) : templates.data?.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Belum ada template email"
              description="Buat template pertama untuk mempercepat penulisan pesan berikutnya."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {templates.data?.map((t) => (
                <Card className="space-y-3 p-5" key={t.id}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{t.name}</h3>
                    <div className="flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => setEditing(t)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={`Hapus ${t.name}`}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Hapus template ${t.name}?`))
                            void perform(
                              () => api.delete(`/email-outreach/templates/${t.id}`),
                              'Template dihapus.',
                            );
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm font-medium">{t.subject}</p>
                  <p className="line-clamp-4 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                    {t.body}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      chooseTemplate(t.id);
                      setTab('compose');
                    }}
                  >
                    Pakai template
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="history">
          <p className="mb-4 text-sm text-muted-foreground">
            100 email terbaru
            {user.role === 'SUPER_ADMIN' ? ' dari seluruh pengguna' : ' milik Anda'}. Ringkasan di
            atas menghitung seluruh riwayat. Pengiriman tetap berjalan saat halaman ditutup.
          </p>
          {history.isError ? (
            <FormError message="Riwayat belum dapat dimuat. Coba muat ulang halaman." />
          ) : history.data?.items.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="Belum ada pengiriman email"
              description="Mulai dari Tulis email, lalu periksa pesan sebelum memasukkannya ke antrean."
            />
          ) : (
            <div className="space-y-3">
              {history.data?.items.map((m) => (
                <Card key={m.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-all font-medium">{m.recipient}</p>
                      <Badge
                        variant={
                          m.status === 'FAILED' || m.status === 'UNVERIFIED'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {labels[m.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-sm">{m.subject}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(m.createdAt)}
                    </p>
                    {m.detail && <p className="mt-1 text-xs text-muted-foreground">{m.detail}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDetail(m)}>
                      Lihat pesan
                    </Button>
                    {m.status === 'QUEUED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            () => api.post(`/email-outreach/${m.id}/cancel`),
                            'Email dibatalkan.',
                          )
                        }
                      >
                        Batalkan
                      </Button>
                    )}
                    {m.status === 'ACCEPTED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRaw(`${m.recipientName ? `${m.recipientName} ` : ''}<${m.recipient}>`);
                          setSubject(m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`);
                          setBody('');
                          setSelected('');
                          setTab('compose');
                        }}
                      >
                        Tulis follow-up
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogTitle>Tinjau pengiriman email</DialogTitle>
          <DialogDescription>
            Periksa setiap pesan. Setelah dikirim, email tidak dapat ditarik dari inbox penerima.
          </DialogDescription>
          <p className="break-words text-sm">
            Pengirim: <strong>{config.data?.sender}</strong>
          </p>
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {review?.recipients.map((r) => (
              <div key={r.email} className="rounded-lg border p-3 text-sm">
                <p className="break-all font-semibold">{r.email}</p>
                <p className="mt-2 font-medium">{personalize(review.subject, r)}</p>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {personalize(review.body, r)}
                </p>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              Saya sudah memeriksa pesan dan penerima, serta memastikan penerima bersedia dihubungi.
            </span>
          </label>
          <FormError message={error} />
          <Button
            disabled={!confirmed || busy || !config.data?.enabled}
            onClick={() => void submit()}
          >
            <Send className="size-4" />{' '}
            {busy ? 'Memasukkan ke antrean…' : `Kirim ${review?.recipients.length ?? 0} email`}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{editing?.id ? 'Edit template email' : 'Template email baru'}</DialogTitle>
          <DialogDescription>Template ini tersimpan untuk pengguna Anda.</DialogDescription>
          {editing && (
            <>
              <FormField label="Nama template" htmlFor="email-template-name">
                <Input
                  id="email-template-name"
                  value={editing.name}
                  maxLength={80}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </FormField>
              <FormField label="Subjek template" htmlFor="email-template-subject">
                <Input
                  id="email-template-subject"
                  maxLength={200}
                  value={editing.subject}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                />
              </FormField>
              <FormField label="Isi template" htmlFor="email-template-body">
                <Textarea
                  id="email-template-body"
                  rows={7}
                  maxLength={10000}
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                />
              </FormField>
              <FormError message={error} />
              <Button
                disabled={
                  busy ||
                  !editing.name.trim() ||
                  !editing.subject.trim() ||
                  editing.body.trim().length < 5
                }
                onClick={() =>
                  void perform(async () => {
                    const { id, ...input } = editing;
                    if (id) await api.patch(`/email-outreach/templates/${id}`, input);
                    else await api.post('/email-outreach/templates', input);
                    setEditing(null);
                  }, 'Template disimpan.')
                }
              >
                Simpan template
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{detail?.subject}</DialogTitle>
          <DialogDescription>
            {detail?.sender} → {detail?.recipient}
          </DialogDescription>
          <p className="whitespace-pre-wrap break-words text-sm">{detail?.body}</p>
          <p className="text-sm text-muted-foreground">
            {detail && labels[detail.status]}
            {detail?.detail && ` · ${detail.detail}`}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
