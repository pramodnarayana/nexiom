
import { useParams, Navigate } from 'react-router-dom';
import { Activity, ChevronRight, FileJson, AlertTriangle, AlertCircle } from 'lucide-react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { type TraceSummary } from '../api/trace.api';
import { usePipelineTracePage } from '../hooks/usePipelineTracePage';
import { useTraceRow } from '../hooks/useTraceRow';

// Colors for status dots
const getStatusColor = (status: string) => {
  if (status === 'SUCCESS' || status === 'COMPLETED') return 'bg-green-500 shadow-green-500/50';
  if (status === 'FAIL') return 'bg-destructive shadow-destructive/50';
  if (status === 'RETRY' || status === 'PENDING' || status === 'PROCESSING') return 'bg-amber-500 shadow-amber-500/50';
  return 'bg-muted-foreground/50';
};

const getStatusBorder = (status: string) => {
  if (status === 'SUCCESS' || status === 'COMPLETED') return 'border-green-500/20';
  if (status === 'FAIL') return 'border-destructive/20';
  if (status === 'RETRY' || status === 'PENDING' || status === 'PROCESSING') return 'border-amber-500/20';
  return 'border-border';
};

function LayerTimeline({ layer, status, durationMs }: Readonly<{ layer: string, status: string, durationMs?: number | null }>) {
  const isPulsing = status === 'PROCESSING' || status === 'PENDING';

  return (
    <div className={`flex flex-col items-center justify-center p-3 rounded-xl border bg-card/60 backdrop-blur-md transition-all ${getStatusBorder(status)}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">{layer}</span>
        <div className="relative flex h-2.5 w-2.5">
          {isPulsing && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getStatusColor(status)}`} />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 shadow-sm ${getStatusColor(status)}`} />
        </div>
      </div>
      <div className="text-[10px] font-mono font-medium text-foreground opacity-80 uppercase tracking-widest">{status}</div>
      {durationMs != null && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{durationMs}ms</div>
      )}
    </div>
  );
}

function JsonViewer({ title, data, className = '' }: Readonly<{ title: string; data: unknown; className?: string }>) {
  if (data === null || data === undefined) return null;
  return (
    <div className={`rounded-xl border bg-muted/20 overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
        <FileJson className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-4 max-h-[300px] overflow-auto">
        <pre className="text-[11px] font-mono leading-relaxed text-foreground/80">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function TraceRow({ summary, stitchId, workspaceId }: Readonly<{ summary: TraceSummary; stitchId: string, workspaceId: string }>) {
  const { expanded, details, loading, errorObj, handleToggle } = useTraceRow(workspaceId, stitchId, summary);
  const [rowParent] = useAutoAnimate<HTMLDivElement>();

  let expandedContent = null;
  if (loading) {
    expandedContent = (
      <div className="flex items-center gap-3 justify-center py-10 opacity-60">
        <div className="flex gap-1">
          <span className="animate-bounce inline-block h-2 w-2 rounded-full bg-primary" />
          <span className="animate-bounce inline-block h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '0.1s' }} />
          <span className="animate-bounce inline-block h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '0.2s' }} />
        </div>
        <span className="text-sm font-medium tracking-tight">Fetching deep trace...</span>
      </div>
    );
  } else if (errorObj) {
    expandedContent = (
      <div className="flex items-center gap-3 justify-center py-10">
        <span className="text-sm font-medium text-destructive">Failed to load detailed trace.</span>
      </div>
    );
  } else if (details) {
    // Extract error message from inbound_gateway.response if FAIL
    const gwResponse = details.inboundGateway?.response as Record<string, unknown> | null | undefined;
    const failureError = details.inboundGateway?.status === 'FAIL' && gwResponse?.error
      ? String(gwResponse.error)
      : null;
    const failureStack = failureError && gwResponse?.stack ? String(gwResponse.stack) : null;

    expandedContent = (
      <>
        {/* ── Error Panel (shown only on FAIL) ── */}
        {failureError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2 animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="text-sm font-semibold">Pipeline Failure</span>
              <Badge variant="destructive" className="ml-auto text-[10px]">FAIL</Badge>
            </div>
            <p className="text-sm font-mono text-destructive/90 break-all">{failureError}</p>
            {failureStack && (
              <details className="mt-1">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">Show stack trace</summary>
                <pre className="mt-2 text-[10px] font-mono text-muted-foreground leading-relaxed overflow-auto max-h-48 bg-muted/30 rounded-lg p-3">{failureStack}</pre>
              </details>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 py-4 px-2 overflow-x-auto snap-x hidden-scrollbar">
          {details.layers.map((l, i) => (
            <div key={`${l.layer}-${i}`} className="flex items-center gap-4 shrink-0 snap-center">
              <LayerTimeline layer={l.layer} status={l.status} durationMs={l.durationMs} />
              {i < details.layers.length - 1 && (
                <div className="h-0.5 w-8 bg-border overflow-hidden rounded-full">
                  <div className="h-full w-full bg-primary/40 rounded-full animate-pulse" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <JsonViewer title="L1 Inbound Request (Raw)" data={details.inboundGateway?.request} />
          {details.inboundGateway?.response != null && (
            <JsonViewer title="L1 App Response / Error" data={details.inboundGateway?.response} />
          )}
          <JsonViewer title="L2 Replica Data" data={details.replicaEntity?.data} />
          <JsonViewer title="L3 Normalized Canonical" data={details.normalizedEntity?.data} />
          <JsonViewer title="L4/L5 Outbound Request" data={details.outboundGateway?.reqPayload} />
          <JsonViewer title="L6 Vendor Response" data={details.outboundGateway?.resPayload} />
        </div>
      </>
    );
  }

  return (
    <div
      ref={rowParent}
      className={`rounded-2xl border transition-all duration-300 overflow-hidden ${expanded ? 'bg-card/90 shadow-lg border-primary/20 ring-1 ring-primary/10' : 'bg-card/40 hover:bg-card/60 hover:shadow-sm'
        }`}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between p-5 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-4">
          <div className={`p-2 rounded-full transition-colors ${expanded ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            <div className={`transition-transform duration-200 ${expanded ? 'rotate-90' : 'rotate-0'}`}>
              <ChevronRight className="h-5 w-5" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{summary.traceId.slice(0, 13)}...</span>
              <Badge variant="outline" className="text-[10px] bg-background/50 backdrop-blur-sm">
                Last Layer: {summary.layer}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-2">
              <Activity className="h-3 w-3" />
              {new Date(summary.timestamp).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {summary.durationMs != null && (
            <span className="text-xs font-mono font-medium text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
              {summary.durationMs}ms
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${getStatusColor(summary.status)}`} />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{summary.status}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-gradient-to-b from-background/50 to-muted/20">
          <div className="p-6 space-y-8">
            {expandedContent}
          </div>
        </div>
      )}
    </div>
  );
}

export function PipelineTracePage() {
  const { id: workspaceId, stitchId } = useParams<{ id: string; stitchId: string }>();

  const { traces, loading, error, fetchTraces } = usePipelineTracePage(workspaceId, stitchId);
  const [listParent] = useAutoAnimate<HTMLDivElement>();

  let pageContent = null;
  if (!workspaceId || !stitchId) {
    return <Navigate to="/dashboard" replace />;
  }
  if (loading) {
    pageContent = (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  } else if (traces.length === 0 && !loading && !error) {
    pageContent = (
      <div className="relative border rounded-3xl p-16 text-center overflow-hidden bg-card/20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
        <Activity className="relative mx-auto h-12 w-12 mb-4 text-primary/40 animate-pulse" />
        <h2 className="relative text-xl font-medium tracking-tight">No traces found</h2>
        <p className="relative text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
          This integration hasn't processed any events yet. Once an event flows through the L1 gateway, its trace timeline will appear here.
        </p>
      </div>
    );
  } else {
    pageContent = (
      <div className="space-y-4" ref={listParent}>
        {traces.map((trace) => (
          <TraceRow key={trace.id} summary={trace} stitchId={stitchId} workspaceId={workspaceId} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Pipeline Traces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            End-to-end trace timeline for stitch validation and debugging.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={() => void fetchTraces()} disabled={loading} className="gap-2 rounded-full">
          <Activity className="h-4 w-4" />
          Live Poll
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl flex items-center gap-3 animate-in fade-in zoom-in duration-300">
          <AlertCircle className="h-5 w-5" />
          <p className="font-medium text-sm">{error}</p>
        </div>
      )}

      {pageContent}
    </div>
  );
}