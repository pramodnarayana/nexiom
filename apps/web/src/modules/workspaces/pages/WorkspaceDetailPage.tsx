import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import {
  getWorkspace,
  type WorkspaceResponse,
} from '../api/workspaces.api';
import { EnvBadge } from '../components/EnvBadge';

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [wsLoading, setWsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchSeqRef = useRef(0);

  const fetchWorkspace = useCallback(async () => {
    if (!id) {
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

  if (wsLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading workspace…
      </div>
    );
  }

  if (!workspace) {
    return <p className="p-6 text-destructive">{error ?? 'Workspace not found.'}</p>;
  }



  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to={AppRoutes.TENANT.WORKSPACES} aria-label="Back to workspaces" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <EnvBadge envType={workspace.envType} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

    </div>
  );
}
