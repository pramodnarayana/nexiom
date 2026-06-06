import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkspace } from '@/modules/workspaces/api/workspaces.api';
import type { WorkspaceResponse } from '@/modules/workspaces/api/workspaces.api';
import { listStitches, archiveStitch, type StitchResponse } from '../api/stitches.api';

export function useStitchesPage(workspaceId: string | undefined) {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<StitchResponse | null>(null);

  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    const myId = ++loadIdRef.current;
    setLoading(true);
    setWorkspace(null);
    setStitches([]);
    setError(null);
    setArchiving(null);
    try {
      const [ws, stitchList] = await Promise.all([
        getWorkspace(workspaceId),
        listStitches(workspaceId),
      ]);
      if (myId !== loadIdRef.current) return;
      setWorkspace(ws);
      setStitches(stitchList);
    } catch (e: unknown) {
      if (myId !== loadIdRef.current) return;
      setWorkspace(null);
      setStitches([]);
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      if (myId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setArchiveTarget(null);
  }, [workspaceId]);

  const handleArchive = async (stitchId: string) => {
    if (archiving) return;
    const token = loadIdRef.current;
    setArchiving(stitchId);
    try {
      await archiveStitch(stitchId);
      if (token !== loadIdRef.current) return;
      setStitches((prev) => prev.filter((s) => s.id !== stitchId));
    } catch (e: unknown) {
      if (token !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to archive stitch.');
    } finally {
      if (token === loadIdRef.current) {
        setArchiving(null);
      }
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const stitchId = archiveTarget.id;
    setArchiveTarget(null);
    await handleArchive(stitchId);
  };

  return {
    workspace,
    stitches,
    loading,
    error,
    archiving,
    archiveTarget,
    setArchiveTarget,
    handleArchiveConfirm,
    load
  };
}
