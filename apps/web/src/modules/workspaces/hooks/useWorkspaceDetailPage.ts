import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkspace, type WorkspaceResponse } from '../api/workspaces.api';

export function useWorkspaceDetailPage(id: string | undefined) {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const fetchWorkspace = useCallback(async () => {
    if (!id) {
      setWorkspace(null);
      setError(null);
      setWsLoading(false);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setWsLoading(true);
    setWorkspace(null);
    try {
      const ws = await getWorkspace(id);
      if (seq !== fetchSeqRef.current) return;
      setWorkspace(ws);
      setError(null);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load workspace.');
    } finally {
      if (seq === fetchSeqRef.current) setWsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const fetchRef = fetchSeqRef;
    void fetchWorkspace();
    return () => {
      fetchRef.current++;
    };
  }, [fetchWorkspace]);

  return {
    workspace,
    wsLoading,
    error,
    fetchWorkspace
  };
}
