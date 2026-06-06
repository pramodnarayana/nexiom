import { useParams, Link } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import { useWorkspaceDetailPage } from '../hooks/useWorkspaceDetailPage';
import { EnvBadge } from '../components/EnvBadge';

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { workspace, wsLoading, error } = useWorkspaceDetailPage(id);

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
