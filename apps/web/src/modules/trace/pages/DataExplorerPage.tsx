import { Navigate } from 'react-router-dom';
import {
  Inbox, Database, Layers,
  ChevronLeft, ChevronRight, RefreshCw, AlertCircle, Trash2, Edit2, Filter, CheckCircle2, XCircle, Clock, ChevronDown
} from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { type StitchResponse } from '@/modules/stitches/api/stitches.api';
import { QueryBuilder } from '../components/QueryBuilder';
import { JsonEditorModal } from '../components/JsonEditorModal';
import { TraceViewerPanel } from '../components/TraceViewerPanel';
import formatXml from 'xml-formatter';
import { useTabPanel } from '../hooks/useTabPanel';
import { useDataExplorer, TABS, type TabId } from '../hooks/useDataExplorer';
import { useState, useEffect, useMemo } from 'react';

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
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
          const xml = formatXml(trimmed, {
            indentation: '  ',
            collapseContent: true,
            lineSeparator: '\n'
          });
          return { pretty: xml, compact: xml };
        } catch {
          return { pretty: obj, compact: obj };
        }
      }
      return { pretty: obj, compact: obj };
    }
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

const JSON_KEYS = new Set(['payload', 'headers', 'data', 'reqPayload', 'resPayload', 'request', 'response']);
const READONLY_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function coerceValue(originalValue: unknown, stringValue: string): unknown {
  if (typeof originalValue === 'boolean') {
    if (stringValue === 'true') return true;
    if (stringValue === 'false') return false;
    return originalValue; 
  }

  if (typeof originalValue === 'number') {
    const parsed = Number(stringValue);
    return Number.isNaN(parsed) ? originalValue : parsed;
  }

  if (stringValue === '') return '';

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

  // eslint-disable-next-line react-hooks/incompatible-library
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

function TabPanel({
  tabId, stitch, workspaceId
}: { readonly tabId: TabId; readonly stitch: StitchResponse; readonly workspaceId: string }) {
  
  const {
    page,
    result,
    loading,
    error,
    showFilters,
    setShowFilters,
    filters,
    setFilters,
    appliedFilters,
    editingJson,
    setEditingJson,
    traceToView,
    setTraceToView,
    objectTypes,
    objectType,
    setObjectType,
    LIMIT,
    handlePage,
    handleApplyFilters,
    handleUpdateCell,
    handleSaveJson,
    handleViewTrace,
    handleDelete,
    load
  } = useTabPanel({ tabId, stitch, workspaceId });

  const availableColumns = useMemo(() => {
    if (!result?.data) return [];
    const set = new Set<string>();
    for (const row of result.data) {
      for (const key of Object.keys(row)) {
        set.add(key);
      }
    }
    return Array.from(set);
  }, [result]);

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
          {objectTypes.length > 0 && (
            <select 
              className="text-xs border border-border rounded px-2 py-1 bg-background mr-2"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
            >
              <option value="">All Entities</option>
              {objectTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
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
          stitchId={stitch.id} 
          traceId={traceToView} 
          workspaceId={workspaceId} 
          onClose={() => setTraceToView(null)} 
        />
      )}
    </div>
  );
}

function StitchSelector({ value, onChange, stitches }: {
  readonly value: StitchResponse | null;
  readonly onChange: (stitch: StitchResponse | null) => void;
  readonly stitches: StitchResponse[];
}) {
  return (
    <select
      id="stitch-selector"
      value={value?.id ?? ''}
      onChange={e => {
        const selected = stitches.find(s => s.id === e.target.value) ?? null;
        onChange(selected);
      }}
      className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[250px]"
    >
      <option value="">Select a Stitch…</option>
      {stitches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

export function DataExplorerPage() {
  const {
    workspaceId,
    activeTab,
    setActiveTab,
    selectedStitch,
    setSelectedStitch,
    activeTabMeta,
    stitches
  } = useDataExplorer();

  if (!workspaceId) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Data Hub</h2>
          <p className="text-sm text-muted-foreground">Inspect raw payloads and parsed entities across all pipeline layers.</p>
        </div>
        <div className="flex items-center gap-3">
          <StitchSelector stitches={stitches} value={selectedStitch} onChange={setSelectedStitch} />
        </div>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto pb-0">
        {TABS.map(tab => {
          const Icon = {
            inbound: Inbox,
            replica: Database,
            normalized: Layers,
            'entity-map': Layers,
            outbound: Database
          }[tab.id];
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
              {Icon && <Icon className="h-4 w-4" />}
              {tab.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground -mt-2">{activeTabMeta.description}</p>

      {!selectedStitch ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center bg-card/20">
          <Database className="mx-auto h-10 w-10 mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a Stitch above to explore its source data.</p>
        </div>
      ) : (
        <TabPanel key={`${activeTab}-${selectedStitch.id}`} tabId={activeTab} stitch={selectedStitch} workspaceId={workspaceId} />
      )}
    </div>
  );
}