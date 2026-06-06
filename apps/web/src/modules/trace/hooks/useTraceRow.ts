import { useState } from 'react';
import { getTrace, type TraceSummary, type FullTrace } from '../api/trace.api';

export function useTraceRow(workspaceId: string, stitchId: string, summary: TraceSummary) {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<FullTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorObj, setErrorObj] = useState<unknown>(null);

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
        console.error(e);
        setErrorObj(e);
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
