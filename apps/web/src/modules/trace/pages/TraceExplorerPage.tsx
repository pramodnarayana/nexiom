import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import {
  Inbox, Database, Layers, Network, Send,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle
} from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  listInbound, listReplica, listNormalized, listEntityMap, listOutbound,
  type ExplorerPage,
} from '../api/data-explorer.api';
import { listStitches, type StitchResponse } from '@/modules/stitches/api/stitches.api';

// ─── Tab config ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'inbound',    label: 'Inbound',           icon: Inbox,    description: 'Raw payloads received from source app (L1)' },
  { id: 'replica',    label: 'Replica',            icon: Database, description: 'Vendor objects stored in replica layer (L2)' },
  { id: 'normalized', label: 'Normalization',      icon: Layers,   description: 'Canonical entities in normalized form (L3)' },
  { id: 'entity-map', label: 'Global Entity Map',  icon: Network,  description: 'Source → Destination record linkage (GEM)' },
  { id: 'outbound',   label: 'Outbound',           icon: Send,     description: 'Payloads delivered to destination app (L5/L6)' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { readonly status: string }) {
  const variant = status === 'SUCCESS' || status === 'COMPLETED' || status === 'REPLICATED'
    ? 'default'
    : status === 'FAIL' || status === 'FAILED'
      ? 'destructive'
      : 'secondary';
  return <Badge variant={variant} className="font-mono text-[10px]">{status}</Badge>;
}

// ─── JSON cell ────────────────────────────────────────────────────────────────

function safeStringify(obj: unknown): { pretty: string; compact: string } {
  try {
    // Create a fresh replacer with its own Set for each stringify pass
    const makeReplacer = () => {
      const seen = new Set<unknown>();
      return (_key: string, val: unknown) => {
        if (val !== null && typeof val === 'object') {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      };
    };

    const pretty = JSON.stringify(obj, makeReplacer(), 2);
    const compact = JSON.stringify(obj, makeReplacer());
    return { pretty, compact };
  } catch {
    return { pretty: '[Unserializable]', compact: '[Unserializable]' };
  }
}

function JsonCell({ value }: { readonly value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const serialized = useMemo(() => safeStringify(value), [value]);

  if (value === null || value === undefined) return <span className="text-muted-foreground italic text-xs">—</span>;

  const preview = serialized.compact.slice(0, 60);
  return (
    <div>
      {expanded ? (
        <div className="relative">
          <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{serialized.pretty}</pre>
          <button type="button" onClick={() => setExpanded(false)} className="absolute top-1 right-1 text-[10px] text-muted-foreground hover:text-foreground px-1">collapse</button>
        </div>
      ) : (
        <button type="button" onClick={() => setExpanded(true)} className="text-[10px] font-mono text-muted-foreground hover:text-foreground text-left truncate max-w-[180px]">
          {preview}{preview.length < serialized.compact.length ? '…' : ''}
        </button>
      )}
    </div>
  );
}

// ─── Generic data table ───────────────────────────────────────────────────────

const JSON_KEYS = new Set(['payload', 'headers', 'data', 'reqPayload', 'resPayload']);

function DataTable<T extends Record<string, unknown>>({ rows }: { readonly rows: T[] }) {
  if (rows.length === 0) return (
    <div className="text-center py-16 text-muted-foreground text-sm">No records found.</div>
  );

  // Compute full column union across all rows to avoid dropping columns that only appear in later rows
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }
  const columns = Array.from(columnSet);

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/40 border-b border-border">
            {columns.map(col => (
              <th key={col} className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)} className={`border-b border-border/60 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
              {columns.map(col => (
                <td key={col} className="px-4 py-3 align-top max-w-[240px]">
                  {col === 'status' && typeof row[col] === 'string'
                    ? <StatusBadge status={row[col] as string} />
                    : JSON_KEYS.has(col)
                      ? <JsonCell value={row[col]} />
                      : <span className="font-mono text-xs text-foreground/80 break-all">{String(row[col] ?? '—')}</span>
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagination controls ──────────────────────────────────────────────────────

function Pagination({ page, total, limit, onPage }: {
  readonly page: number;
  readonly total: number;
  readonly limit: number;
  readonly onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
      <span>{total.toLocaleString()} records &nbsp;·&nbsp; Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

// ─── Tab panel ───────────────────────────────────────────────────────────────

type FetchFn = (stitchId: string, params: { page: number; limit: number; workspaceId?: string }) => Promise<ExplorerPage<Record<string, unknown>>>;

// Cast via unknown to satisfy TypeScript's strict overlap check
const FETCHERS: Record<TabId, FetchFn> = {
  'inbound':    listInbound    as unknown as FetchFn,
  'replica':    listReplica    as unknown as FetchFn,
  'normalized': listNormalized as unknown as FetchFn,
  'entity-map': listEntityMap  as unknown as FetchFn,
  'outbound':   listOutbound   as unknown as FetchFn,
};

const LIMIT = 20;

function TabPanel({
  tabId, stitchId, workspaceId,
}: { readonly tabId: TabId; readonly stitchId: string; readonly workspaceId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerPage<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const fetchFn = FETCHERS[tabId];
      const data = await fetchFn(stitchId, { page: p, limit: LIMIT, workspaceId });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [tabId, stitchId, workspaceId]);

  useEffect(() => { setPage(1); void load(1); }, [load]);

  const handlePage = (p: number) => { setPage(p); void load(p); };

  if (loading) return (
    <div className="space-y-3 mt-4">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-3 mt-8 text-destructive p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <span className="text-sm font-medium">{error}</span>
    </div>
  );

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{result?.total.toLocaleString() ?? 0} total records</span>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => void load(page)}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>
      <DataTable rows={result?.data ?? []} />
      {result && <Pagination page={page} total={result.total} limit={LIMIT} onPage={handlePage} />}
    </div>
  );
}


// ─── Stitch selector ──────────────────────────────────────────────────────────

interface StitchOption { id: string; name: string; }

function StitchSelector({ workspaceId, value, onChange }: {
  readonly workspaceId: string;
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  const [stitches, setStitches] = useState<StitchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listStitches(workspaceId);
      setStitches((res ?? []).map((s: StitchResponse) => ({ id: s.id, name: s.name })));
    } catch (err) {
      console.error('Failed to load stitches:', err);
      setError(err instanceof Error ? err.message : 'Failed to load stitches');
      setStitches([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton className="h-9 w-[200px] rounded-lg" />;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <select
      id="stitch-selector"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      <option value="">Select a Stitch…</option>
      {stitches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TraceExplorerPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('inbound');
  const [stitchId, setStitchId] = useState('');

  // Guard must come after all hooks
  if (!workspaceId) return <Navigate to="/dashboard" replace />;

  const activeTabMeta = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Trace Explorer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse pipeline data across all layers for a given Stitch.
          </p>
        </div>
        <StitchSelector workspaceId={workspaceId} value={stitchId} onChange={setStitchId} />
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 border-b border-border overflow-x-auto pb-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              id={`trace-tab-${tab.id}`}
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-150 ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab description ── */}
      <p className="text-xs text-muted-foreground -mt-2">{activeTabMeta.description}</p>

      {/* ── Content ── */}
      {!stitchId ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center bg-card/20">
          <Network className="mx-auto h-10 w-10 mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a Stitch above to explore its pipeline data.</p>
        </div>
      ) : (
        <TabPanel key={`${activeTab}-${stitchId}`} tabId={activeTab} stitchId={stitchId} workspaceId={workspaceId} />
      )}
    </div>
  );
}