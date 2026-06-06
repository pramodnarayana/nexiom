import { useCallback, useEffect, useRef, useState } from 'react';
import { listTraces, type TraceSummary } from '../api/trace.api';

export function usePipelineTracePage(workspaceId: string | undefined, stitchId: string | undefined) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSeqRef = useRef(0);

  const fetchTraces = useCallback(async () => {
    if (!stitchId || !workspaceId) {
      setLoading(false);
      return;
    }
    const seq = ++fetchSeqRef.current;
    try {
      setLoading(true);
      const res = await listTraces(workspaceId, stitchId, { limit: 50 });
      if (seq !== fetchSeqRef.current) return;
      setTraces(res.data);
      setError(null);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load traces.');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [workspaceId, stitchId]);

  useEffect(() => {
    void fetchTraces();
  }, [fetchTraces]);

  return {
    traces,
    loading,
    error,
    fetchTraces
  };
}
