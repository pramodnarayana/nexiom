import { useCallback, useEffect, useState } from 'react';
import { Plus, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  type WorkspaceResponse,
} from '../api/workspaces.api';
import { EnvBadge } from '../components/EnvBadge';
import { Link } from 'react-router-dom';

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEnvType, setNewEnvType] = useState<'PRODUCTION' | 'SANDBOX'>('PRODUCTION');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspaces(await listWorkspaces());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces.');
    } finally {
      setLoading(false);
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete workspace.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Logical groups of connections and integrations for your team.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Workspace
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspaces…
        </div>
      )}

      {!loading && !error && workspaces.length === 0 && (
        <div className="border rounded-lg p-10 text-center text-muted-foreground">
          <Building2 className="mx-auto h-8 w-8 mb-3 opacity-40" />
          <p className="font-medium">No workspaces yet</p>
          <p className="text-sm mt-1">Create your first workspace to group connections.</p>
        </div>
      )}

      {!loading && workspaces.length > 0 && (
        <div className="divide-y border rounded-lg">
          {workspaces.map((ws) => (
            <div key={ws.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <Link
                  to={`/dashboard/workspaces/${ws.id}`}
                  className="font-medium hover:underline"
                >
                  {ws.name}
                </Link>
                <EnvBadge envType={ws.envType} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(ws)}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.name}</strong> and all its connection assignments will be
              permanently deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDeleteConfirm()}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Workspace</DialogTitle>
            <DialogDescription>
              Create a new workspace by providing a name and environment setting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                placeholder="e.g. Logistics-US"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !creating) void handleCreate(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Environment</Label>
              <div className="flex gap-3">
                {(['PRODUCTION', 'SANDBOX'] as const).map((env) => {
                  const activeClass =
                    env === 'PRODUCTION'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-amber-400 bg-amber-50 text-amber-600';
                  const className = `flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    newEnvType === env ? activeClass : 'border-input text-muted-foreground hover:bg-muted'
                  }`;
                  return (
                    <button
                      key={env}
                      type="button"
                      aria-pressed={newEnvType === env}
                      onClick={() => setNewEnvType(env)}
                      className={className}
                    >
                      {env}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
