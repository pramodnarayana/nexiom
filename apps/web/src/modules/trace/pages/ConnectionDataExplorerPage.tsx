import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import {
  Inbox, Database, Layers,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, Trash2, Edit2, Filter, CheckCircle2, XCircle, Clock, ChevronDown, Loader2, Calculator
} from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useToast } from '@/shared/hooks/use-toast';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  listConnectionInbound, listConnectionReplica, listConnectionNormalized, listConnectionOutbound,
  updateRecord, deleteRecord, syncConnectionObject,
  type ExplorerPage,
} from '../api/data-explorer.api';
import { listObjects } from '../../stitches/api/metadata.api';
import { listActiveConnections, type ActiveConnectionResponse as ConnectionResponse } from '@/modules/connections/api/connections.api';
import { QueryBuilder, type FilterGroup } from '../components/QueryBuilder';
import { JsonEditorModal } from '../components/JsonEditorModal';
import { Combobox } from '@/shared/components/ui/combobox';
import { TraceViewerPanel } from '../components/TraceViewerPanel';
import formatXml from 'xml-formatter';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { apiClient } from '@/shared/lib/api-client';

// ─── Tab config ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'inbound',    label: 'Inbound',           icon: Inbox,    description: 'Raw payloads received from source app (L1)' },
  { id: 'replica',    label: 'Replica',            icon: Database, description: 'Vendor objects stored in replica layer (L2)' },
  { id: 'normalized', label: 'Normalization',      icon: Layers,   description: 'Canonical entities in normalized form (L3)' },
  // Entity Map tab removed until real data fetcher exists
  // { id: 'entity-map', label: 'Entity Map',         icon: Layers,   description: 'Cross-system source to target ID linkages (L4)' },
  { id: 'outbound',   label: 'Outbound',           icon: Database, description: 'Payloads sent to the destination app (L5/L6)' },
] as const;

type TabId = typeof TABS[number]['id'];

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { readonly status: string }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const isSuccess = s === 'SUCCESS' || s === 'COMPLETED' || s === 'REPLICATED' || s === 'ACTIVE';
  const isFail = s === 'FAIL' || s === 'FAILED' || s === 'ARCHIVED';
  
  const variant = isSuccess ? 'success' : isFail ? 'destructive' : 'secondary';
  const Icon = isSuccess ? CheckCircle2 : isFail ? XCircle : s === 'PROCESSING' ? Clock : AlertCircle;

  return (
    <Badge variant={variant} className={`font-mono text-[11px] gap-1 px-2 py-0.5 whitespace-nowrap shadow-sm border ${isSuccess ? 'border-green-600/30' : isFail ? 'border-red-600/30' : 'border-transparent'}`}>
      <Icon className="w-3 h-3" />
      {status}
    </Badge>
  );
}



function safeStringify(obj: unknown): { pretty: string; compact: string } {
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    try {
      const parsed = JSON.parse(trimmed);
      // If it parsed successfully and is an object/array, format it nicely
      if (parsed && typeof parsed === 'object') {
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
        return { 
          pretty: JSON.stringify(parsed, makeReplacer(), 2), 
          compact: JSON.stringify(parsed, makeReplacer()) 
        };
      }
    } catch {
      // It's not JSON. Check if it's XML.
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
          const xml = formatXml(trimmed, {
            indentation: '  ',
            collapseContent: true,
            lineSeparator: '\n'
          });
          return { pretty: xml, compact: xml };
        } catch {
          // If xml-formatter fails, fallback to raw text
          return { pretty: obj, compact: obj };
        }
      }
      // Return raw text
      return { pretty: obj, compact: obj };
    }
    // If it was a simple string JSON (e.g. "foo"), just return it
    return { pretty: obj, compact: obj };
  }

  try {
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


// ─── Generic data table ───────────────────────────────────────────────────────

const JSON_KEYS = new Set(['payload', 'headers', 'data', 'reqPayload', 'resPayload', 'request', 'response']);
const READONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function coerceValue(originalValue: unknown, stringValue: string): unknown {
  // If original was boolean, map "true"/"false" strings
  if (typeof originalValue === 'boolean') {
    if (stringValue === 'true') return true;
    if (stringValue === 'false') return false;
    return originalValue; // Keep original if invalid
  }

  // If original was a number, parse to Number
  if (typeof originalValue === 'number') {
    const parsed = Number(stringValue);
    return Number.isNaN(parsed) ? originalValue : parsed;
  }

  // For empty string, preserve as empty string
  if (stringValue === '') return '';

  // Otherwise return the string value
  return stringValue;
}

function DataTableRow<T extends Record<string, unknown>>({ 
  row, 
  onDelete,
  onViewTrace,
  onUpdateCell,
  onEditJson,
  tabId
}: { 
  readonly row: import('@tanstack/react-table').Row<T>; 
  readonly onDelete: (row: T) => void;
  readonly onViewTrace: (row: T) => void;
  readonly onUpdateCell: (row: T, field: string, value: unknown) => Promise<void>;
  readonly onEditJson: (row: T, field: string, value: unknown) => void;
  readonly tabId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rowData = row.original;

  return (
    <>
      <tr 
        onClick={() => setExpanded(!expanded)} 
        className="border-b border-border/60 hover:bg-muted/20 transition-colors cursor-pointer bg-muted/10 group"
      >
        {row.getVisibleCells().map((cell: import('@tanstack/react-table').Cell<T, unknown>) => (
          <td key={cell.id} className="p-0 align-top max-w-[240px] border-r border-border/10">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
        <td className="px-4 py-3 align-middle text-center w-24 sticky right-0 bg-background border-l border-border/50 shadow-[-4px_0_12px_rgba(0,0,0,0.05)]">
          <div className="flex justify-end gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className={`h-7 w-7 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} 
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            {Boolean((rowData as Record<string, unknown>).traceId ?? (rowData as Record<string, unknown>).trace_id) && (
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 text-primary hover:bg-primary/10 shadow-sm"
                onClick={(e) => { e.stopPropagation(); onViewTrace(rowData); }}
                title="View Trace"
              >
                <Layers className="h-4 w-4" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-muted/5">
          <td colSpan={row.getVisibleCells().length + 1} className="p-4">
            <div className="bg-background rounded-md border border-border p-4 shadow-sm max-h-[500px] overflow-auto">
              <div className="flex justify-between items-center mb-4 border-b border-border pb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full Record Details</h4>
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(rowData); }} className="h-7 text-xs">
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                  {Boolean((rowData as Record<string, unknown>).traceId ?? (rowData as Record<string, unknown>).trace_id) && (
                    <Button variant="default" size="sm" onClick={(e) => { e.stopPropagation(); onViewTrace(rowData); }} className="h-7 text-xs ml-2 shadow-sm">
                      <Layers className="w-3 h-3 mr-1" /> View Trace
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                {Object.entries(rowData)
                  .filter(([key]) => !JSON_KEYS.has(key))
                  .map(([key, val]) => (
                    <div key={key} className="space-y-1">
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase">{key}</h5>
                      {READONLY_FIELDS.has(key) ? (
                        <div className="font-mono text-xs text-foreground break-all bg-muted/5 p-2 rounded-md border border-border/50">
                          {String(val ?? '—')}
                        </div>
                      ) : (
                        <div className="bg-muted/5 rounded-md border border-border/50 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
                          <EditableCell
                            initialValue={String(val ?? '')}
                            onSave={(newValue) => onUpdateCell(rowData, key, coerceValue(val, newValue))}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                {Object.entries(rowData)
                  .filter(([key, val]) => JSON_KEYS.has(key) && val !== undefined && val !== null)
                  .map(([key, val]) => {
                    const isReadOnlyJson = (tabId === 'inbound' || tabId === 'outbound') && 
                      ['request', 'response', 'headers', 'reqPayload', 'resPayload', 'payload'].includes(key);

                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase">{key}</h5>
                          {!isReadOnlyJson && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs text-primary" onClick={() => onEditJson(rowData, key, val)}>
                              <Edit2 className="w-3 h-3 mr-1" /> Edit JSON
                            </Button>
                          )}
                        </div>
                        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/10 p-3 rounded-md border border-border/80">
                          {safeStringify(val).pretty}
                        </pre>
                      </div>
                    );
                  })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EditableCell({
  initialValue,
  onSave
}: {
  readonly initialValue: string;
  readonly onSave: (val: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const onBlur = async () => {
    if (value !== initialValue) {
      setIsSaving(true);
      try {
        await onSave(value);
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="relative flex items-center w-full h-full min-h-[36px]">
      <input
        value={value}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        onChange={e => setValue(e.target.value)}
        onBlur={onBlur}
        disabled={isSaving}
        className={`bg-transparent outline-none w-full h-full px-3 py-2 text-xs font-mono transition-all ${isSaving ? 'opacity-50 cursor-wait' : ''}`}
        title={value}
        placeholder="Empty"
      />
    </div>
  );
}

function DataTable<T extends Record<string, unknown>>({ 
  rows,
  tabId,
  onUpdateCell,
  onEditJson,
  onDelete,
  onViewTrace
}: { 
  readonly rows: T[];
  readonly tabId: string;
  readonly onUpdateCell: (row: T, field: string, value: unknown) => Promise<void>;
  readonly onEditJson: (row: T, field: string, value: unknown) => void;
  readonly onDelete: (row: T) => void;
  readonly onViewTrace: (row: T) => void;
}) {
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }
  const HIDDEN_COLUMNS = new Set(['id', 'traceId', 'trace_id', 'dataSourceId']);
  const columnsRaw = Array.from(columnSet).filter(col => !HIDDEN_COLUMNS.has(col));
  const preferredOrder = ['status', 'objectType', 'entityType', 'canonicalType', 'createdAt', 'updatedAt'];
  
  const sortedColumns = columnsRaw.sort((a, b) => {
    const idxA = preferredOrder.indexOf(a);
    const idxB = preferredOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const columns = useMemo(() => {
    const helper = createColumnHelper<T>();
    return sortedColumns.map(col => 
      helper.accessor((row: T) => row[col], {
        id: col,
        header: col,
        cell: (info) => {
          const val = info.getValue();
          
          if (col === 'id' || col === 'createdAt' || col === 'updatedAt') {
            return <div className="px-4 py-3 font-mono text-xs text-foreground/50 break-all">{String(val ?? '—')}</div>;
          }
          if ((col === 'status' || col === 'state') && typeof val === 'string') {
            return <div className="px-4 py-3"><StatusBadge status={val} /></div>;
          }
          if (JSON_KEYS.has(col)) {
            return (
              <div className="px-4 py-3 italic text-xs flex items-center gap-1 text-muted-foreground">
                <span>{val ? '{...}' : '—'}</span>
              </div>
            );
          }

          return (
            <div className="px-4 py-3 text-xs truncate" title={String(val ?? '')}>
              {String(val ?? '—')}
            </div>
          );
        }
      })
    );
  }, [sortedColumns]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">No records found.</div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id} className="bg-muted/40 border-b border-border">
              {headerGroup.headers.map(header => (
                <th key={header.id} className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
              <th className="px-4 py-3 w-16 sticky right-0 bg-muted/40 border-l border-border/50 shadow-[-4px_0_12px_rgba(0,0,0,0.05)] z-10"></th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <DataTableRow 
              key={row.id} 
              row={row} 
              onDelete={onDelete}
              onViewTrace={onViewTrace}
              onUpdateCell={onUpdateCell}
              onEditJson={onEditJson}
              tabId={tabId}
            />
          ))}
        </tbody>
      </table>
      )}
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

type FetchFn = (connectionId: string, params: { page: number; limit: number; workspaceId?: string; filters?: FilterGroup; objectType?: string }) => Promise<ExplorerPage<Record<string, unknown>>>;

// Cast via unknown to satisfy TypeScript's strict overlap check
const FETCHERS: Record<TabId, FetchFn> = {
  'inbound':    listConnectionInbound    as unknown as FetchFn,
  'replica':    listConnectionReplica    as unknown as FetchFn,
  'normalized': listConnectionNormalized as unknown as FetchFn,
  'outbound':   listConnectionOutbound   as unknown as FetchFn,
};

const LIMIT = 20;

function TabPanel({
  tabId, stitch, workspaceId, objectType
}: { readonly tabId: TabId; readonly stitch: ConnectionResponse; readonly workspaceId: string; readonly objectType: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerPage<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Advanced Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterGroup>({ logic: 'and', rules: [] });
  const [appliedFilters, setAppliedFilters] = useState<FilterGroup>({ logic: 'and', rules: [] });
  
  // JSON editing logic (cell specific)
  const [editingJson, setEditingJson] = useState<{ row: Record<string, unknown>, field: string, value: unknown } | null>(null);

  // Trace Viewer State
  const [traceToView, setTraceToView] = useState<string | null>(null);

  const { toast } = useToast();

  const getDataSourceId = useCallback(() => stitch.id, [stitch.id]);


  const load = useCallback(async (p: number, currentFilters?: FilterGroup, currentObjType?: string) => {
    setLoading(true);
    setError(null);
    try {
      const fetchFn = FETCHERS[tabId];
      const activeFilters = currentFilters?.rules.length ? currentFilters : undefined;
      const data = await fetchFn(stitch.id, { page: p, limit: LIMIT, workspaceId, filters: activeFilters, objectType: currentObjType });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [tabId, stitch.id, workspaceId]);

  useEffect(() => { 
    setPage(1); 
    void load(1, appliedFilters, objectType); 
  }, [load, objectType, appliedFilters]); 

  const handlePage = (p: number) => { setPage(p); void load(p, appliedFilters, objectType); };
  
  const handleApplyFilters = () => {
    setAppliedFilters(filters);
  };

  const handleUpdateCell = async (row: Record<string, unknown>, field: string, value: unknown) => {
    try {
      await updateRecord(workspaceId, getDataSourceId(), tabId, String(row.id), { [field]: value });
      
      // Optimistically update local state so we don't trigger a full table unmount
      setResult(prev => {
        if (!prev) return prev;
        const newData = prev.data.map(r => String(r.id) === String(row.id) ? { ...r, [field]: value } : r);
        return { ...prev, data: newData };
      });
      
      toast({ description: `Updated ${field}` });
    } catch (e: unknown) {
      toast({ variant: 'destructive', description: `Failed to update ${field}: ${(e as Error).message}` });
    }
  };

  const handleSaveJson = async (updatedData: unknown) => {
    if (!editingJson) return;
    try {
      await updateRecord(workspaceId, getDataSourceId(), tabId, String(editingJson.row.id), { [editingJson.field]: updatedData });
      
      setResult(prev => {
        if (!prev) return prev;
        const newData = prev.data.map(r => String(r.id) === String(editingJson.row.id) ? { ...r, [editingJson.field]: updatedData } : r);
        return { ...prev, data: newData };
      });
      
      setEditingJson(null);
      toast({ description: `Updated ${editingJson.field}` });
    } catch (e: unknown) {
      toast({ variant: 'destructive', description: `Failed to update JSON: ${(e as Error).message}` });
    }
  };



  const handleViewTrace = (row: Record<string, unknown>) => {
    const traceId = row.traceId ?? row.trace_id;
    if (traceId) {
      setTraceToView(String(traceId));
    } else {
      alert('This record does not have a traceId.');
    }
  };

  const handleDelete = async (row: Record<string, unknown>) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteRecord(workspaceId, getDataSourceId(), tabId, String(row.id));
      void load(page, filters, objectType);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };



  const availableColumns = useMemo(() => {
    if (!result?.data) return [];
    const set = new Set<string>();
    for (const row of result.data) {
      for (const key of Object.keys(row)) {
        set.add(key);
      }
    }
    return Array.from(set);
  }, [result?.data]);

  if (loading && !result) return (
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
    <div className="mt-4 relative">
      {loading && result && (
        <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{result?.total.toLocaleString() ?? 0} total records</span>
        <div className="flex gap-2 items-center">
          <Button 
            variant={showFilters ? "secondary" : "ghost"} 
            size="sm" 
            className="gap-1.5 text-xs" 
            onClick={() => {
              if (!showFilters && filters.rules.length === 0) {
                setFilters({ logic: 'and', rules: [{ field: '', operator: 'eq', value: '' }] });
              }
              setShowFilters(!showFilters);
            }}
          >
            <Filter className="h-3 w-3" /> Filters {filters.rules.length > 0 && `(${filters.rules.length})`}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => void load(page, appliedFilters, objectType)}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>
      
      {showFilters && (
        <QueryBuilder 
          filters={filters} 
          columns={availableColumns}
          onChange={setFilters} 
          onApply={handleApplyFilters} 
        />
      )}
      
      <DataTable 
        rows={result?.data ?? []} 
        tabId={tabId}
        onUpdateCell={handleUpdateCell}
        onEditJson={(row, field, value) => setEditingJson({ row, field, value })}
        onDelete={handleDelete}
        onViewTrace={handleViewTrace}
      />
      {result && <Pagination page={page} total={result.total} limit={LIMIT} onPage={handlePage} />}
      
      {editingJson && (
        <JsonEditorModal
          title={`Edit ${editingJson.field} (ID: ${String(editingJson.row.id).split('-')[0]})`}
          initialData={editingJson.value}
          onSave={handleSaveJson}
          onClose={() => setEditingJson(null)}
        />
      )}



      {traceToView && (
        <TraceViewerPanel 
          connectionId={stitch.id} 
          traceId={traceToView} 
          workspaceId={workspaceId} 
          onClose={() => setTraceToView(null)} 
        />
      )}
    </div>
  );
}


// ─── Stitch Selector ──────────────────────────────────────────────────

function ConnectionSelector({ workspaceId, value, onChange }: {
  readonly workspaceId: string;
  readonly value: ConnectionResponse | null;
  readonly onChange: (stitch: ConnectionResponse | null) => void;
}) {
  const [connections, setConnections] = useState<ConnectionResponse[]>([]);
  
  useEffect(() => {
    void listActiveConnections().then(setConnections).catch(console.error);
  }, [workspaceId]);

  return (
    <select
      id="connection-selector"
      value={value?.id ?? ''}
      onChange={e => {
        const selected = connections.find(s => s.id === e.target.value) ?? null;
        onChange(selected);
      }}
      className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[250px]"
    >
      <option value="">Select a Connection…</option>
      {connections.map(s => (
        <option key={s.id} value={s.id}>
          {s.displayName} ({s.appName})
        </option>
      ))}
    </select>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

function ConnectionDataExplorerPageContent() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('inbound');
  const [selectedConnection, setSelectedConnection] = useState<ConnectionResponse | null>(null);

  const [objectTypes, setObjectTypes] = useState<unknown[]>([]);
  const [objectType, setObjectType] = useState<string>('');
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!selectedConnection) {
      setObjectTypes([]);
      setObjectType('');
      return;
    }
    
    let mounted = true;
    setObjectsLoading(true);
    listObjects(selectedConnection.id)
      .then(objects => {
        if (mounted) {
          const safeObjects = Array.isArray(objects) ? objects : [];
          setObjectTypes(safeObjects);
          setObjectType(prev => {
            if (safeObjects.length === 0) return '';
            const typeNames = safeObjects.map(o => typeof o === 'string' ? o : ((o as { name?: string })?.name || ''));
            if (!prev || !typeNames.includes(prev)) return typeNames[0] ?? '';
            return prev;
          });
        }
      })
      .catch(e => {
        console.error('Failed to list objects', e);
        if (mounted) {
          toast({ title: 'Error loading objects', description: e.message, variant: 'destructive' });
        }
      })
      .finally(() => {
        if (mounted) setObjectsLoading(false);
      });
    return () => { mounted = false; };
  }, [selectedConnection, toast]);

  // Reset count when connection or object changes
  useEffect(() => {
    setRecordCount(null);
  }, [selectedConnection, objectType]);

  const handleGetCount = async () => {
    if (!selectedConnection || !objectType) return;
    setIsCounting(true);
    try {
      const res = await apiClient.get<{ count: number | null }>(
        `/stitches/metadata/${selectedConnection.id}/objects/${encodeURIComponent(objectType)}/count`
      );
      setRecordCount(res.data.count ?? null);
      if (res.data.count === null) {
         toast({ description: 'Connector does not support counting records.', variant: 'default' });
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }, message?: string };
      toast({ variant: 'destructive', description: `Failed to get count: ${err?.response?.data?.message || err.message}` });
    } finally {
      setIsCounting(false);
    }
  };

  const handleSync = async () => {
    if (!selectedConnection || !objectType || !workspaceId) return;
    setIsSyncing(true);
    try {
      toast({ description: `Sync started for ${objectType}` });
      const res = await syncConnectionObject(workspaceId, selectedConnection.id, objectType) as { status?: string, streamResults?: { error?: string }[] };
      
      // The API returns 200 OK even if the sync failed internally. We must check the payload.
      if (res && res.status === 'failed') {
        const errorMsg = res.streamResults?.[0]?.error || 'Unknown error occurred during sync loop';
        throw new Error(errorMsg);
      }

      toast({ description: `Sync completed for ${objectType}` });
      setRefreshKey(prev => prev + 1);
    } catch (e) {
      toast({ variant: 'destructive', description: `Sync failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setIsSyncing(false);
    }
  };

  // Guard must come after all hooks
  if (!workspaceId) return <Navigate to="/dashboard" replace />;

  const activeTabMeta = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
        {/* ── Data Explorer Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Data Hub</h2>
          <p className="text-sm text-muted-foreground">Inspect raw payloads and parsed entities across all pipeline layers.</p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionSelector workspaceId={workspaceId} value={selectedConnection} onChange={setSelectedConnection} />
          {objectsLoading ? (
            <div className="w-[300px] flex items-center gap-2 text-sm text-muted-foreground border border-border bg-muted/20 px-3 py-2 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Fetching objects...
            </div>
          ) : objectTypes.length > 0 ? (
            <div className="w-[300px]">
              <Combobox
                options={(objectTypes || []).map(o => {
                  if (typeof o === 'string') return { value: o, label: o };
                  return { value: (o as { name?: string })?.name || '', label: (o as { label?: string, name?: string })?.label || (o as { name?: string })?.name || '' };
                })}
                value={objectType}
                onValueChange={setObjectType}
                placeholder="Select an object"
                searchPlaceholder="Search objects..."
                emptyMessage="No objects found"
              />
            </div>
          ) : (
            <div className="w-[300px] flex items-center text-sm text-muted-foreground italic px-2">
              No objects available.
            </div>
          )}
          {selectedConnection && objectType && (
            <div className="flex items-center gap-3 ml-2 border-l border-border pl-4">
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleGetCount}
                  disabled={isCounting}
                  variant="outline"
                  size="sm"
                  className="gap-2 shadow-sm"
                >
                  {isCounting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                  {recordCount !== null ? `${recordCount.toLocaleString()} Records` : 'Get Count'}
                </Button>
              </div>
              <Button
                onClick={handleSync}
                disabled={isSyncing}
                size="sm"
                className="gap-2 shadow-sm font-medium tracking-wide bg-primary/90 hover:bg-primary"
              >
                {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {isSyncing ? 'Syncing...' : 'Run Sync'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex flex-col gap-6">
        <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-border w-max overflow-x-auto custom-scrollbar">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === t.id 
                    ? 'bg-background text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-border/80 scale-[1.02]' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${activeTab === t.id ? 'text-primary' : 'opacity-70'}`} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-4 p-4 rounded-xl bg-primary/5 border border-primary/10">
          <div className="p-2 bg-background rounded-lg shadow-sm border border-border shrink-0">
            {React.createElement(activeTabMeta.icon, { className: 'w-5 h-5 text-primary' })}
          </div>
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              {activeTabMeta.label}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">{activeTabMeta.description}</p>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {!selectedConnection ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center bg-card/20">
          <Database className="mx-auto h-10 w-10 mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a Connection above to explore its source data.</p>
        </div>
      ) : !objectType && !objectsLoading ? (
        <div className="text-center py-20 bg-muted/10 border border-border rounded-xl mt-6 animate-in fade-in">
          <Database className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No Object Selected</h3>
          <p className="text-sm text-muted-foreground">Please search and select an object from the dropdown above to explore its data.</p>
        </div>
      ) : (
        <>
          {isSyncing && (
            <div className="mb-4 animate-in fade-in slide-in-from-top-2">
              <div className="h-1.5 w-full bg-primary/20 overflow-hidden rounded-full">
                <div className="h-full bg-primary w-full origin-left animate-[pulse_1.5s_ease-in-out_infinite] scale-x-50" />
              </div>
              <p className="text-xs font-medium text-primary mt-2 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Synchronizing bulk data in the background...
              </p>
            </div>
          )}
          <TabPanel key={`${activeTab}-${selectedConnection.id}-${objectType}-${refreshKey}`} tabId={activeTab} stitch={selectedConnection} workspaceId={workspaceId} objectType={objectType} />
        </>
      )}
    </div>
  );
}

export function ConnectionDataExplorerPage() {
  return (
    <ErrorBoundary>
      <ConnectionDataExplorerPageContent />
    </ErrorBoundary>
  );
}