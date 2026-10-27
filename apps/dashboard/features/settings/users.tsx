'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  adminResetPasswordSchema,
  canManageRole,
  createUserSchema,
  PERMISSIONS,
  ROLE_CODES,
  ROLE_LABELS,
  USER_STATUS_LABELS,
  type CreateUserInput,
  type RoleCode,
} from '@smge/shared';
import type { Paginated, RoleDto, UserDto } from '@smge/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  ShieldOff,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
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
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { api, applyServerErrors } from '@/lib/api';
import { formatRelative } from '@/lib/utils';

const ALL = '__all__';

type PendingAction = { type: 'disable' | 'enable' | 'unlock' | 'reset2fa'; user: UserDto } | null;

export function UsersCard() {
  const { user: me, can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can(PERMISSIONS.USERS_MANAGE);
  const canManage = canCreate && me.role === 'SUPER_ADMIN';
  const [search, setSearch] = useState('');
  const [role, setRole] = useState(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const debounced = useDebounce(search);

  const q = useQuery({
    queryKey: ['users', { page, search: debounced, role }],
    queryFn: () =>
      api.get<Paginated<UserDto>>('/users', {
        page,
        pageSize: 20,
        search: debounced,
        role: role === ALL ? undefined : role,
      }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const manageable = (u: UserDto) => canManage && u.id !== me.id && canManageRole(me.role, u.role);

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: RoleCode }) =>
      api.patch(`/users/${id}`, { role }),
    onSuccess: async () => {
      toast.success('Role diperbarui');
      await invalidate();
    },
  });

  const runPending = async () => {
    if (!pending) return;
    const { type, user } = pending;
    if (type === 'disable' || type === 'enable') {
      await api.patch(`/users/${user.id}`, { status: type === 'disable' ? 'DISABLED' : 'ACTIVE' });
    } else if (type === 'unlock') {
      await api.post(`/users/${user.id}/unlock`);
    } else {
      await api.post(`/users/${user.id}/reset-2fa`);
    }
    toast.success('Perubahan disimpan');
    await invalidate();
  };

  const pendingText: Record<
    NonNullable<PendingAction>['type'],
    { title: string; desc: string; label: string }
  > = {
    disable: {
      title: 'Nonaktifkan pengguna?',
      desc: 'Semua sesi pengguna langsung diakhiri dan ia tidak dapat login.',
      label: 'Nonaktifkan',
    },
    enable: {
      title: 'Aktifkan kembali pengguna?',
      desc: 'Pengguna dapat login kembali.',
      label: 'Aktifkan',
    },
    unlock: {
      title: 'Buka kunci akun?',
      desc: 'Penghitung percobaan login gagal akan direset.',
      label: 'Buka kunci',
    },
    reset2fa: {
      title: 'Reset 2FA pengguna?',
      desc: 'Pengguna harus menyiapkan ulang 2FA. Semua sesinya diakhiri.',
      label: 'Reset 2FA',
    },
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Pengguna</CardTitle>
          <CardDescription>
            {me.role === 'ADMIN'
              ? 'Tambahkan pengguna Marketing Operator atau Viewer. Perubahan akun yang sudah ada ditangani Super Admin.'
              : 'Kelola akses tim. Anda hanya dapat mengelola pengguna dengan role di bawah Anda.'}
          </CardDescription>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Tambah pengguna
          </Button>
        )}
      </CardHeader>
      <div className="flex flex-col gap-2 border-y p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari nama atau email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari pengguna"
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52" aria-label="Filter role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Semua role</SelectItem>
            {ROLE_CODES.filter((r) => me.role === 'SUPER_ADMIN' || canManageRole(me.role, r)).map(
              (r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      {q.isPending ? (
        <TableSkeleton cols={5} />
      ) : !q.data?.items.length ? (
        <EmptyState title="Tidak ada pengguna" description="Ubah pencarian atau filter." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Pengguna</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Login terakhir</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Aksi</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">
                      {u.name}{' '}
                      {u.id === me.id && (
                        <span className="text-xs text-muted-foreground">(Anda)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>
                    {manageable(u) ? (
                      <Select
                        value={u.role}
                        onValueChange={(v) => changeRole.mutate({ id: u.id, role: v as RoleCode })}
                      >
                        <SelectTrigger className="h-8 w-44" aria-label={`Role ${u.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_CODES.filter((r) => canManageRole(me.role, r)).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      ROLE_LABELS[u.role]
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={u.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {USER_STATUS_LABELS[u.status]}
                      </Badge>
                      {u.lockedUntil && (
                        <Badge variant="destructive">
                          <Lock /> Terkunci
                        </Badge>
                      )}
                      {u.twoFactorEnabled && <Badge variant="outline">2FA</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Belum pernah'}
                  </TableCell>
                  <TableCell>
                    {manageable(u) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Aksi untuk ${u.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setResetUser(u)}>
                            <KeyRound /> Atur ulang password
                          </DropdownMenuItem>
                          {u.lockedUntil && (
                            <DropdownMenuItem
                              onSelect={() => setPending({ type: 'unlock', user: u })}
                            >
                              <Lock /> Buka kunci
                            </DropdownMenuItem>
                          )}
                          {u.twoFactorEnabled && (
                            <DropdownMenuItem
                              onSelect={() => setPending({ type: 'reset2fa', user: u })}
                            >
                              <ShieldOff /> Reset 2FA
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {u.status === 'ACTIVE' ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setPending({ type: 'disable', user: u })}
                            >
                              <UserX /> Nonaktifkan
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => setPending({ type: 'enable', user: u })}
                            >
                              <UserCheck /> Aktifkan
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? pendingText[pending.type].title : ''}
        description={
          pending && (
            <>
              <strong>{pending.user.name}</strong> — {pendingText[pending.type].desc}
            </>
          )
        }
        confirmLabel={pending ? pendingText[pending.type].label : ''}
        destructive={pending?.type === 'disable' || pending?.type === 'reset2fa'}
        onConfirm={runPending}
      />
    </Card>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => unknown;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah pengguna</DialogTitle>
          <DialogDescription>
            Bagikan password awal secara aman; minta pengguna menggantinya setelah login.
          </DialogDescription>
        </DialogHeader>
        <CreateUserForm onCreated={onCreated} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({ onCreated, onDone }: { onCreated: () => unknown; onDone: () => void }) {
  const { user: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', role: 'MARKETING_OPERATOR', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post('/users', values);
      toast.success('Pengguna ditambahkan');
      await onCreated();
      onDone();
    } catch (e) {
      setError(applyServerErrors(e, form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={error} />
      <FormField label="Nama" htmlFor="u-name" error={errors.name?.message}>
        <Input id="u-name" {...form.register('name')} />
      </FormField>
      <FormField label="Email" htmlFor="u-email" error={errors.email?.message}>
        <Input id="u-email" type="email" {...form.register('email')} />
      </FormField>
      <FormField label="Role" error={errors.role?.message}>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_CODES.filter((r) => canManageRole(me.role, r)).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField
        label="Password awal"
        htmlFor="u-password"
        error={errors.password?.message}
        hint="Minimal 10 karakter, huruf besar, huruf kecil, angka."
      >
        <Input
          id="u-password"
          type="password"
          autoComplete="new-password"
          {...form.register('password')}
        />
      </FormField>
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

function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const form = useForm<{ password: string }>({
    resolver: zodResolver(adminResetPasswordSchema),
    defaultValues: { password: '' },
  });
  useEffect(() => {
    if (user) form.reset();
  }, [user, form]);
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api.post(`/users/${user!.id}/reset-password`, values);
      toast.success('Password diatur ulang. Semua sesi pengguna diakhiri.');
      onClose();
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atur ulang password</DialogTitle>
          <DialogDescription>
            {user?.name} harus login ulang dengan password baru.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField
            label="Password baru"
            htmlFor="r-password"
            error={form.formState.errors.password?.message}
          >
            <Input
              id="r-password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PERMISSION_GROUP_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  users: 'Pengguna',
  roles: 'Role',
  audit: 'Log audit',
  accounts: 'Akun TikTok',
  campaigns: 'Campaign',
  leads: 'Prospek',
  outreach: 'Outbound',
  conversations: 'Percakapan',
  ai: 'AI',
  knowledge: 'Knowledge base',
  integrations: 'Integrasi',
  analytics: 'Analitik',
  settings: 'Pengaturan sistem',
};

export function RolesCard() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDto[]>('/roles') });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role & hak akses</CardTitle>
        <CardDescription>
          Hak akses tiap role (RBAC). Setiap pengguna hanya dapat membuka fitur sesuai role-nya.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {q.isPending
          ? null
          : q.data?.map((r) => {
              const groups = Object.entries(
                r.permissions.reduce<Record<string, string[]>>((acc, p) => {
                  const [res, action] = p.split(':');
                  (acc[res] ??= []).push(action);
                  return acc;
                }, {}),
              );
              return (
                <div key={r.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{r.name}</p>
                    <Badge variant="secondary">{r.userCount} pengguna</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {groups.map(([res, actions]) => (
                      <Badge key={res} variant="outline" className="font-normal">
                        {PERMISSION_GROUP_LABELS[res] ?? res}: {actions.map(actionLabel).join(', ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
      </CardContent>
    </Card>
  );
}

function actionLabel(a: string) {
  return (
    (
      {
        read: 'lihat',
        manage: 'kelola',
        view: 'lihat',
        export: 'export',
        import: 'import',
        work: 'kerjakan',
        review: 'review',
        reply: 'balas',
        use: 'gunakan',
      } as Record<string, string>
    )[a] ?? a
  );
}
