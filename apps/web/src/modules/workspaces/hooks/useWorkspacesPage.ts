import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  type WorkspaceResponse,
} from '../api/workspaces.api';

export function useWorkspacesPage(refreshWorkspaces: () => void) {
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEnvType, setNewEnvType] = useState<'PRODUCTION' | 'SANDBOX'>('PRODUCTION');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSeqRef = useRef(0);

  const fetchWorkspaces = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const data = await listWorkspaces();
      if (seq !== fetchSeqRef.current) return;
      setWorkspaces(data);
      setError(null);
    } catch (e: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load workspaces.');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleCreate = async () => {
    if (creating || !newName.trim()) return;
    setCreating(true);
    try {
      const created = await createWorkspace({ name: newName.trim(), envType: newEnvType });
      setWorkspaces((prev) => [...prev, created]);
      setDialogOpen(false);
      setNewName('');
      setNewEnvType('PRODUCTION');
      void fetchWorkspaces();
      refreshWorkspaces();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleting || !deleteTarget) return;
    setDeleting(true);
    const targetId = deleteTarget.id;
    try {
      await deleteWorkspace(targetId);
      setWorkspaces((prev) => prev.filter((ws) => ws.id !== targetId));
      setDeleteTarget(null);
      void fetchWorkspaces();
      refreshWorkspaces();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete workspace.');
    } finally {
      setDeleting(false);
    }
  };

  return {
    workspaces,
    loading,
    error,
    dialogOpen,
    setDialogOpen,
    creating,
    newName,
    setNewName,
    newEnvType,
    setNewEnvType,
    deleteTarget,
    setDeleteTarget,
    deleting,
    handleCreate,
    handleDeleteConfirm,
  };
}
