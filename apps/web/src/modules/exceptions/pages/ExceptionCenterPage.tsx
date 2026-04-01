import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, SearchX } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Skeleton } from '@/shared/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import {
  listExceptions,
  retryException,
  dismissException,
  type ExceptionItem,
  type ExceptionStatus,
} from '../api/exceptions.api';

const SKELETON_KEYS = ['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5'];

export function ExceptionCenterPage() {
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ExceptionStatus>('unresolved');
  
  const [parent] = useAutoAnimate<HTMLTableSectionElement>();
  
  // Track actions per row
  const [actionStates, setActionStates] = useState<Record<string, { type: 'retry' | 'dismiss'; loading: boolean }>>({});

  const fetchSeqRef = useRef(0);

  const fetchExceptions = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      // Just pulling a 50 limit for phase 1
      const res = await listExceptions({ status: statusFilter, limit: 50 });
      if (seq !== fetchSeqRef.current) return;
      setExceptions(res.data);
      setError(null);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load exceptions.');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchExceptions();
  }, [fetchExceptions]);

  const handleAction = async (id: string, action: 'retry' | 'dismiss') => {
    setActionStates((prev) => ({ ...prev, [id]: { type: action, loading: true } }));
    try {
      if (action === 'retry') {
        await retryException(id);
      } else {
        await dismissException(id);
      }
      setError(null);
      // Remove after successful delete
      setExceptions((prev) => prev.filter((item) => item.id !== id));
    } catch (e: unknown) {
      setError(`Failed to ${action} exception: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const getReasonFromPayload = (resPayload: unknown, statusCode: number | null): string => {
    if (!resPayload) return statusCode ? `HTTP ${statusCode}` : 'Unknown failure';
    if (typeof resPayload === 'string' || typeof resPayload === 'number' || typeof resPayload === 'boolean') {
      return String(resPayload);
    }
    if (typeof resPayload === 'object' && resPayload !== null) {
      const p = resPayload as Record<string, unknown>;
      if (p.message) return typeof p.message === 'string' ? p.message : JSON.stringify(p.message);
      if (p.error) return typeof p.error === 'string' ? p.error : JSON.stringify(p.error);
    }
    return JSON.stringify(resPayload);
  };

  let tableContent = null;
  if (loading) {
    tableContent = SKELETON_KEYS.map((key) => (
      <TableRow key={key}>
        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
        <TableCell><Skeleton className="h-4 w-64" /></TableCell>
        <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
        <TableCell className="text-center"><Skeleton className="h-6 w-16 mx-auto rounded-full" /></TableCell>
        <TableCell className="text-right flex justify-end gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </TableCell>
      </TableRow>
    ));
  } else if (exceptions.length === 0) {
    tableContent = (
      <TableRow>
        <TableCell colSpan={6} className="h-64 text-center">
          <div className="relative flex flex-col items-center justify-center p-8 overflow-hidden rounded-xl border border-dashed bg-muted/10">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-blue-500/5" />
            <SearchX className="h-10 w-10 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-foreground relative">No {statusFilter} exceptions</h3>
            <p className="text-sm text-muted-foreground relative mt-1 max-w-sm">
              Your pipelines are healthy. We couldn't find any {statusFilter} records matching these criteria.
            </p>
          </div>
        </TableCell>
      </TableRow>
    );
  } else {
    tableContent = (
      <>
        {exceptions.map((exc) => {
          const action = actionStates[exc.id];
          const isRetrying = action?.type === 'retry' && action.loading;
          const isDismissing = action?.type === 'dismiss' && action.loading;

          return (
            <TableRow
              key={exc.id}
              className={`group hover:bg-muted/30 transition-colors ${action ? 'opacity-50' : ''}`}
            >
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {new Intl.DateTimeFormat('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                }).format(new Date(exc.updatedAt))}
              </TableCell>
              <TableCell>
                <div className="font-mono text-xs">
                  {exc.routeId.length > 13 ? exc.routeId.slice(0, 13) + '...' : exc.routeId}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-[300px] truncate text-sm font-medium">
                  {getReasonFromPayload(exc.resPayload, exc.statusCode)}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {exc.attemptCount}
                </span>
              </TableCell>
              <TableCell className="text-center">
                {exc.status === 'RETRY' || exc.status === 'FAIL' ? (
                  <div className="flex items-center justify-center gap-1.5 text-destructive">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                    </span>
                    <span className="text-xs font-medium uppercase">{exc.status}</span>
                  </div>
                ) : (
                  <Badge variant="secondary" className="text-[10px] uppercase">{exc.status}</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity">
                  {statusFilter === 'unresolved' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!action}
                        onClick={() => void handleAction(exc.id, 'dismiss')}
                        className="h-8 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors rounded-full"
                      >
                        {isDismissing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Dismiss'}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        disabled={!!action}
                        onClick={() => void handleAction(exc.id, 'retry')}
                        className="h-8 rounded-full shadow-sm hover:shadow active:scale-95 transition-all"
                      >
                        {isRetrying ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        Retry
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Exception Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and resolve Dead Letter Queue (DLQ) pipeline failures.
          </p>
        </div>
        
        <div role="radiogroup" aria-label="Exception Status Filter" className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg border">
          {(['unresolved', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                statusFilter === s 
                  ? 'bg-background shadow-sm text-foreground' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg flex items-center gap-3 animate-in fade-in zoom-in duration-300">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="rounded-xl border bg-card/50 backdrop-blur-sm shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead>Route / Stitch ID</TableHead>
              <TableHead>Failure Reason</TableHead>
              <TableHead className="text-center">Attempts</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={parent}>
            {tableContent}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
