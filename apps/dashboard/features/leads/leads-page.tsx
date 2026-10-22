'use client';

import {
  CONTACT_CHANNEL_LABELS,
  CONTACT_CHANNELS,
  INTEREST_LEVEL_LABELS,
  INTEREST_LEVELS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  PERMISSIONS,
} from '@smge/shared';
import {
  Ban,
  CalendarClock,
  Download,
  FileUp,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, PageHeader, Pagination, TableSkeleton } from '@/components/common';
import { InterestBadge, LeadStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui/overlays';
import {
  Badge,
  Card,
  Checkbox,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { useAccountOptions, useCampaignOptions } from '@/hooks/use-lookups';
import { downloadUrl } from '@/lib/api';
import { HIDE_OFFICIAL_LANE } from '@/lib/marketing-scope';
import { formatRelative } from '@/lib/utils';
import { useLeads } from './api';
import { DncList } from './dnc-list';
import { ImportDialog } from './import-dialog';
import { LeadFormDialog } from './lead-form-dialog';

const ALL = '__all__';
const FILTER_KEYS = [
  'status',
  'interestLevel',
  'source',
  'sourceAccountId',
  'sourceCampaignId',
  'operatorId',
  'consentChannel',
  'followUp',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

export function leadContact(l: {
  tiktokUsername: string | null;
  email: string | null;
  phone: string | null;
}) {
  return [l.tiktokUsername && `@${l.tiktokUsername}`, l.email, l.phone].filter(Boolean).join(' · ');
}

export function LeadsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') === 'dnc' ? 'dnc' : 'leads';
  return (
    <>
      <LeadsHeader />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          router.replace(v === 'dnc' ? '/leads?tab=dnc' : '/leads', { scroll: false })
        }
      >
        <TabsList>
          <TabsTrigger value="leads">
            <Users /> Prospek
          </TabsTrigger>
          <TabsTrigger value="dnc">
            <Ban /> Larangan kontak
          </TabsTrigger>
        </TabsList>
        <TabsContent value="leads">
          <LeadsTable />
        </TabsContent>
        <TabsContent value="dnc">
          <DncList />
        </TabsContent>
      </Tabs>
    </>
  );
}

function LeadsHeader() {
  const { can } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="CRM / Prospek"
        description="Kelola followers dan prospek yang dapat diakses oleh akun kamu."
        actions={
          <>
            {can(PERMISSIONS.LEADS_IMPORT) && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileUp /> Import CSV
              </Button>
            )}
            {can(PERMISSIONS.LEADS_MANAGE) && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Tambah prospek
              </Button>
            )}
          </>
        }
      />
      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

function LeadsTable() {
  const { can, user } = useAuth();
  const params = useSearchParams();
  const accounts = useAccountOptions();
  const campaigns = useCampaignOptions();
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [includeDnc, setIncludeDnc] = useState(false);
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>(() => {
    const initial: Partial<Record<FilterKey, string>> = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) initial[k] = v;
    }
    return initial;
  });
  const debounced = useDebounce(search);
  const debouncedTag = useDebounce(tag);

  const query = {
    ...filters,
    search: debounced || undefined,
    tag: debouncedTag || undefined,
    includeDoNotContact: includeDnc || undefined,
  };
  const q = useLeads({ ...query, page, pageSize: 25 });
  const activeFilters =
    Object.values(filters).filter(Boolean).length + (debouncedTag ? 1 : 0) + (includeDnc ? 1 : 0);

  const setFilter = (k: FilterKey) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v === ALL ? undefined : v }));
    setPage(1);
  };
  const filterSelect = (
    k: FilterKey,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <Select value={filters[k] ?? ALL} onValueChange={setFilter(k)}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: semua</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
    values.map((v) => ({ value: v, label: labels[v] }));

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari nama, @username, email, atau nomor…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            aria-label="Cari prospek"
          />
        </div>
        <Button
          variant={showFilters ? 'secondary' : 'outline'}
          onClick={() => setShowFilters((s) => !s)}
        >
          <SlidersHorizontal /> Filter {activeFilters > 0 && <Badge>{activeFilters}</Badge>}
        </Button>
        {can(PERMISSIONS.LEADS_EXPORT) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={downloadUrl('/leads/export', { ...query, format: 'xlsx' })} download>
                  Excel (.xlsx)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={downloadUrl('/leads/export', { ...query, format: 'csv' })} download>
                  CSV
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {showFilters && (
        <div className="grid gap-2 border-b bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {filterSelect(
            'status',
            'Status',
            opts(
              LEAD_STATUSES.filter((s) => s !== 'DO_NOT_CONTACT'),
              LEAD_STATUS_LABELS,
            ),
          )}
          {filterSelect(
            'interestLevel',
            'Ketertarikan',
            opts(INTEREST_LEVELS, INTEREST_LEVEL_LABELS),
          )}
          {filterSelect('source', 'Sumber', opts(LEAD_SOURCES, LEAD_SOURCE_LABELS))}
          {filterSelect(
            'consentChannel',
            'Izin kanal',
            opts(CONTACT_CHANNELS, CONTACT_CHANNEL_LABELS),
          )}
          {filterSelect(
            'sourceAccountId',
            'Akun',
            (accounts.data ?? []).map((a) => ({ value: a.id, label: `@${a.username}` })),
          )}
          {!HIDE_OFFICIAL_LANE &&
            filterSelect(
              'sourceCampaignId',
              'Campaign',
              (campaigns.data ?? []).map((c) => ({ value: c.id, label: c.name })),
            )}
          {filterSelect('operatorId', 'Operator', [
            { value: 'me', label: 'Prospek saya' },
            { value: 'none', label: 'Belum ditugaskan' },
          ])}
          {filterSelect('followUp', 'Follow-up', [
            { value: 'due', label: 'Jatuh tempo' },
            { value: 'scheduled', label: 'Terjadwal' },
          ])}
          <Input
            placeholder="Tag, mis. webinar"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Filter tag"
          />
          <Label className="font-normal">
            <Checkbox checked={includeDnc} onChange={(e) => setIncludeDnc(e.target.checked)} />{' '}
            Tampilkan yang dilarang dihubungi
          </Label>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => {
              setFilters({});
              setTag('');
              setIncludeDnc(false);
            }}
          >
            Reset filter
          </Button>
        </div>
      )}

      {q.isPending ? (
        <TableSkeleton cols={6} />
      ) : q.isError ? (
        <EmptyState title="Gagal memuat prospek" description={q.error.message} />
      ) : !q.data.items.length ? (
        <EmptyState
          icon={activeFilters || debounced ? Search : Users}
          title={activeFilters || debounced ? 'Tidak ada prospek yang cocok' : 'Belum ada prospek'}
          description={
            activeFilters || debounced
              ? 'Ubah kata kunci atau filter.'
              : 'Tambahkan prospek secara manual atau import dari formulir yang sah.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Prospek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ketertarikan</TableHead>
                <TableHead>Sumber</TableHead>
                <TableHead>Izin</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Kontak terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((l) => {
                const due = l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= new Date();
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                        {l.name ?? <span className="text-muted-foreground italic">Tanpa nama</span>}
                      </Link>
                      <p className="max-w-64 truncate text-xs text-muted-foreground">
                        {leadContact(l)}
                      </p>
                      {user.role === 'SUPER_ADMIN' && (
                        <p className="text-xs text-muted-foreground">
                          Pemilik: {l.owner?.name ?? 'Belum ditetapkan'}
                        </p>
                      )}
                      {l.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {l.tags.slice(0, 3).map((t) => (
                            <Badge key={t} variant="outline" className="px-1.5 py-0 text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <LeadStatusBadge status={l.status} />
                    </TableCell>
                    <TableCell>
                      <InterestBadge level={l.interestLevel} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {LEAD_SOURCE_LABELS[l.source]}
                      {l.sourceAccount && (
                        <p className="text-xs text-muted-foreground">@{l.sourceAccount.username}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.consentChannels.length ? (
                        <Tooltip
                          content={l.consentChannels
                            .map((c) => CONTACT_CHANNEL_LABELS[c])
                            .join(', ')}
                        >
                          <Badge variant="success">
                            <ShieldCheck /> {l.consentChannels.length}
                          </Badge>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{l.operator?.name ?? '—'}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatRelative(l.lastContactedAt)}
                      {l.nextFollowUpAt && (
                        <span
                          className={`flex items-center gap-1 text-xs ${due ? 'font-medium text-destructive' : ''}`}
                        >
                          <CalendarClock className="size-3" /> FU {formatRelative(l.nextFollowUpAt)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
