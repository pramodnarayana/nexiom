
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { ArrowLeft, GitMerge, Loader2, Pencil, Plus, Trash2, Activity } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/shared/components/ui/dialog';
import { useStitchesPage } from '../hooks/useStitchesPage';
import type { StitchStatus } from '../api/stitches.api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: StitchStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'INACTIVE') return 'secondary';
  return 'outline';
}



// ── Page ──────────────────────────────────────────────────────────────────────

export function StitchesPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    workspace,
    stitches,
    loading,
    error,
    archiving,
    archiveTarget,
    setArchiveTarget,
    handleArchiveConfirm,
  } = useStitchesPage(workspaceId);

  if (!workspaceId) {
    return (
      <div className="p-6 text-sm text-destructive">
        Invalid workspace URL.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading stitches…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to={`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}`}
          aria-label="Back to workspace"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <GitMerge className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">
          Stitches
          {workspace && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              — {workspace.name}
            </span>
          )}
        </h1>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Actions */}
      {!error && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {stitches.length === 0
              ? 'No stitches yet. Create one to start syncing data between connections.'
              : `${stitches.length} ${stitches.length === 1 ? 'stitch' : 'stitches'}`}
          </p>
          <Button
            size="sm"
            onClick={() => { navigate(`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches/new`); }}
          >
            <Plus className="mr-2 h-3.5 w-3.5" />
            New Stitch
          </Button>
        </div>
      )}

      {/* List */}
      {!error && (stitches.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm space-y-2">
          <GitMerge className="h-8 w-8 mx-auto opacity-30" />
          <p>No stitches yet.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { navigate(`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches/new`); }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            New Stitch
          </Button>
        </div>
      ) : (
        <div className="divide-y border rounded-lg">
          {stitches.map((stitch) => (
            <div key={stitch.id} className="flex items-center justify-between px-4 py-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{stitch.name}</p>
                  <Badge variant={statusVariant(stitch.status)} className="shrink-0 text-xs">
                    {stitch.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {stitch.canonicalObject} → {stitch.targetObject}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => { navigate(`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches/${stitch.id}/traces`); }}
                >
                  <Activity className="mr-2 h-3 w-3" />
                  Traces
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => { navigate(`${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches/${stitch.id}`); }}
                  aria-label="Edit stitch"
                >
                  <Pencil className="mr-2 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={archiving !== null}
                  onClick={() => { setArchiveTarget(stitch); }}
                  aria-label="Archive stitch"
                >
                  {archiving === stitch.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Archive confirmation */}
      <Dialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive stitch?</DialogTitle>
            <DialogDescription>
              <strong>{archiveTarget?.name}</strong> will be archived and stop syncing. You can
              create a new stitch with the same connections if needed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setArchiveTarget(null); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={archiving !== null}
              onClick={() => { void handleArchiveConfirm(); }}
            >
              {archiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
