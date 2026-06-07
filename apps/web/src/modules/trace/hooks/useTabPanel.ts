import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/shared/hooks/use-toast';
import {
  listInbound, listReplica, listNormalized, listOutbound, listEntityMap,
  updateRecord, deleteRecord, listObjectsByStitch,
  type ExplorerPage,
} from '../api/data-explorer.api';
import type { StitchResponse } from '@/modules/stitches/api/stitches.api';
import type { FilterGroup } from '../components/QueryBuilder';

type TabId = 'inbound' | 'replica' | 'normalized' | 'entity-map' | 'outbound';

type FetchFn = (stitchId: string, params: { page: number; limit: number; workspaceId?: string; filters?: FilterGroup; objectType?: string }) => Promise<ExplorerPage<Record<string, unknown>>>;

const FETCHERS: Record<TabId, FetchFn> = {
  'inbound':    listInbound    as unknown as FetchFn,
  'replica':    listReplica    as unknown as FetchFn,
  'normalized': listNormalized as unknown as FetchFn,
  'entity-map': listEntityMap  as unknown as FetchFn,
  'outbound':   listOutbound   as unknown as FetchFn,
};

const LIMIT = 20;

export function useTabPanel({
  tabId, stitch, workspaceId
}: {
  tabId: TabId;
  stitch: StitchResponse;
  workspaceId: string;
}) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerPage<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterGroup>({ logic: 'and', rules: [] });
  const [appliedFilters, setAppliedFilters] = useState<FilterGroup>({ logic: 'and', rules: [] });
  
  const [editingJson, setEditingJson] = useState<{ row: Record<string, unknown>, field: string, value: unknown } | null>(null);
  const [traceToView, setTraceToView] = useState<string | null>(null);

  const [objectTypes, setObjectTypes] = useState<string[]>([]);
  const [objectType, setObjectType] = useState<string>('');
  const [objectTypeInitialized, setObjectTypeInitialized] = useState(false);

  const requestIdRef = useRef<number>(0);

  const { toast } = useToast();

  const getDataSourceId = useCallback(() => tabId === 'outbound' ? stitch.destDataSourceId : stitch.srcDataSourceId, [tabId, stitch.destDataSourceId, stitch.srcDataSourceId]);

  useEffect(() => {
    let mounted = true;
    setObjectTypeInitialized(false);
    if (tabId === 'normalized' || tabId === 'replica' || tabId === 'inbound') {
      listObjectsByStitch(stitch.id, tabId, workspaceId)
        .then(types => {
          if (mounted) {
            setObjectTypes(types);
            setObjectType(prev => {
              if (types.length === 0) return '';
              if (!prev || !types.includes(prev)) return types[0] ?? '';
              return prev;
            });
            setObjectTypeInitialized(true);
          }
        })
        .catch((err) => {
          console.error(err);
          if (mounted) {
            setObjectTypes([]);
            setObjectType('');
            setObjectTypeInitialized(true);
          }
        });
    } else {
      setObjectTypes([]);
      setObjectType('');
      setObjectTypeInitialized(true);
    }
    return () => { mounted = false; };
  }, [tabId, workspaceId, stitch.id]);

  const load = useCallback(async (p: number, currentFilters?: FilterGroup, currentObjType?: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const fetchFn = FETCHERS[tabId];
      const activeFilters = currentFilters?.rules.length ? currentFilters : undefined;
      const data = await fetchFn(stitch.id, { page: p, limit: LIMIT, workspaceId, filters: activeFilters, objectType: currentObjType });
      if (requestId === requestIdRef.current) {
        setResult(data);
      }
    } catch (e) {
      if (requestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load data.');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [tabId, stitch.id, workspaceId]);

  useEffect(() => { 
    if (!objectTypeInitialized) return;
    setPage(1); 
    void load(1, appliedFilters, objectType); 
  }, [load, objectType, appliedFilters, objectTypeInitialized]); 

  const handlePage = (p: number) => { setPage(p); void load(p, appliedFilters, objectType); };
  
  const handleApplyFilters = () => setAppliedFilters(filters);

  const handleUpdateCell = async (row: Record<string, unknown>, field: string, value: unknown) => {
    try {
      await updateRecord(workspaceId, getDataSourceId(), tabId, String(row.id), { [field]: value });
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
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteRecord(workspaceId, getDataSourceId(), tabId, String(row.id));
      void load(page, appliedFilters, objectType);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  return {
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
  };
}
