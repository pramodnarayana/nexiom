import { Loader2, Server, Database, Layers, ArrowRight, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/shared/components/ui/sheet';
import { Badge } from '@/shared/components/ui/badge';
import { getTrace } from '../api/data-explorer.api';
import { useQuery } from '@tanstack/react-query';
import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toUpperCase();
  const isSuccess = s === 'SUCCESS' || s === 'COMPLETED' || s === 'REPLICATED' || s === 'ACTIVE';
  const isFail = s === 'FAIL' || s === 'FAILED' || s === 'ARCHIVED';
  
  const variant = isSuccess ? 'success' : isFail ? 'destructive' : 'secondary';
  const Icon = isSuccess ? CheckCircle2 : isFail ? XCircle : s === 'PROCESSING' ? Clock : AlertCircle;

  return (
    <Badge variant={variant} className={`font-mono text-[10px] gap-1 px-1.5 py-0 h-5 border ${isSuccess ? 'border-green-600/30' : isFail ? 'border-red-600/30' : 'border-transparent'}`}>
      <Icon className="w-3 h-3" />
      {status}
    </Badge>
  );
}

function JsonViewer({ data }: { data: unknown }) {
  if (!data) return <span className="text-muted-foreground italic text-xs">No data</span>;
  return (
    <div className="bg-muted/30 p-2 rounded-md border border-border mt-2 overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar json-view-wrapper text-xs">
      <JsonView data={data} shouldExpandNode={(level) => level < 2} style={defaultStyles} />
    </div>
  );
}

export function TraceViewerPanel({
  stitchId,
  traceId,
  workspaceId,
  onClose
}: {
  stitchId: string;
  traceId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['trace', stitchId, traceId, workspaceId],
    queryFn: () => getTrace(stitchId, traceId, workspaceId),
    retry: 1,
  });
  
  const error = queryError ? (queryError as Error).message : null;

  return (
    <Sheet open={true} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg md:max-w-xl overflow-y-auto w-[600px] border-l-border custom-scrollbar">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            Pipeline Trace
          </SheetTitle>
          <SheetDescription className="text-xs break-all">
            ID: {traceId}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center h-48 space-y-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Fetching trace lifecycle...</p>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-lg border border-destructive/20">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
            
            {/* L1: Inbound */}
            <div className="relative flex items-start gap-4 md:gap-6">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0 z-10 shadow-sm">
                <Server className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-2 pb-6 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">1. Source Inbound (L1)</h4>
                  <StatusBadge status={data.layers.l1?.status} />
                </div>
                {data.layers.l1 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div>Object Type: <span className="font-mono text-foreground">{data.layers.l1.objectType || 'Unknown'}</span></div>
                    <div className="mt-4 mb-1 font-semibold text-foreground">Request</div>
                    <JsonViewer data={data.layers.l1.request} />
                    {!!data.layers.l1.response && (
                      <>
                        <div className="mt-4 mb-1 font-semibold text-foreground">Response</div>
                        <JsonViewer data={data.layers.l1.response} />
                      </>
                    )}
                    {!!data.layers.l1.headers && (
                      <>
                        <div className="mt-4 mb-1 font-semibold text-foreground">Headers</div>
                        <JsonViewer data={data.layers.l1.headers} />
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No L1 record found.</p>
                )}
              </div>
            </div>

            {/* L2: Replica */}
            <div className="relative flex items-start gap-4 md:gap-6">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0 z-10 shadow-sm">
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-2 pb-6 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">2. Source Replica (L2)</h4>
                </div>
                {data.layers.l2 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div>Entity Type: <span className="font-mono text-foreground">{data.layers.l2.entityType}</span></div>
                    <div>Source ID: <span className="font-mono text-foreground">{data.layers.l2.sourceId}</span></div>
                    <JsonViewer data={data.layers.l2.data} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No L2 record found.</p>
                )}
              </div>
            </div>

            {/* L3: Normalized */}
            <div className="relative flex items-start gap-4 md:gap-6">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0 z-10 shadow-sm">
                <Layers className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-2 pb-6 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">3. Normalized (L3)</h4>
                </div>
                {data.layers.l3 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div>Canonical Type: <span className="font-mono text-foreground">{data.layers.l3.canonicalType}</span></div>
                    <JsonViewer data={data.layers.l3.data} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No L3 record found.</p>
                )}
              </div>
            </div>

            {/* L6: Outbound */}
            <div className="relative flex items-start gap-4 md:gap-6">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-500/10 text-purple-500 border border-purple-500/20 shrink-0 z-10 shadow-sm">
                <ArrowRight className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-2 pb-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">4. Target Outbound (L6)</h4>
                  <StatusBadge status={data.layers.l6?.status} />
                </div>
                {data.layers.l6 ? (
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div>Status Code: <span className="font-mono text-foreground">{data.layers.l6.statusCode || 'N/A'}</span></div>
                    {data.layers.l6.lastError && (
                      <div className="text-destructive">Error: <span className="font-mono">{data.layers.l6.lastError}</span></div>
                    )}
                    <div className="mt-4 mb-1 font-semibold text-foreground">Payload</div>
                    <JsonViewer data={data.layers.l6.payload} />
                    {!!data.layers.l6.response && (
                      <>
                        <div className="mt-4 mb-1 font-semibold text-foreground">Response</div>
                        <JsonViewer data={data.layers.l6.response} />
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No L6 record found.</p>
                )}
              </div>
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
