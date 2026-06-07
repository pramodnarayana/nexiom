import { useState } from 'react';
import { getTrace, type TraceSummary, type FullTrace } from '../api/trace.api';

export function useTraceRow(workspaceId: string, stitchId: string, summary: TraceSummary) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<FullTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorObj, setErrorObj] = useState<string | null>(null);

  const handleToggle = async () => {
    if (loading) return;
    setExpanded(prev => !prev);
    if (!expanded && !details) {
      setLoading(true);
      setErrorObj(null);
      try {
        const full = await getTrace(workspaceId, stitchId, summary.traceId);
        setDetails(full);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(errorMessage);
        setErrorObj(errorMessage);
      } finally {
        setLoading(false);
      }
    }
  };

  return {
    expanded,
    details,
    loading,
    errorObj,
    handleToggle
  };
}
