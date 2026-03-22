import { useEffect, useMemo, useState } from 'react';
import { GitMerge, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import {
  adminListStitches,
  adminUpdateSchedule,
  adminBulkUpdateOrgSchedule,
} from '@/modules/stitches/api/admin-stitches.api';
import type { StitchResponse } from '@/modules/stitches/api/stitches.api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lastSyncedLabel(lastScheduledAt: string | null): string {
  if (!lastScheduledAt) return 'Never';
  const diffMs = Date.now() - new Date(lastScheduledAt).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${Math.max(1, diffHr)}h ago`;
  return `${Math.max(1, Math.floor(diffHr / 24))}d ago`;
}

/** Renders first 8 hex chars of a UUID for compact display. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function stitchBadgeVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'PAUSED') return 'secondary';
  return 'outline';
}

// ── Row-level edit state ──────────────────────────────────────────────────────

interface RowEdit {
  interval: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminStitchesPage() {
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Client-side filters
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  // Per-row edit state keyed by stitch id
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});

  // Bulk override
  const [bulkOrgId, setBulkOrgId] = useState('');
  const [bulkInterval, setBulkInterval] = useState('');
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaved, setBulkSaved] = useState(false);

  useEffect(() => {
    adminListStitches()
      .then((data) => {
        setStitches(data);
        // Pre-fill per-row interval edits from loaded data
        const edits: Record<string, RowEdit> = {};
        data.forEach((s) => {
          edits[s.id] = {
            interval: String(s.syncIntervalMinutes),
            saving: false,
            error: null,
            saved: false,
          };
        });
        setRowEdits(edits);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load stitches.');
      })
      .finally(() => { setLoading(false); });
  }, []);

  // Unique org ids for the filter dropdown
  const orgIds = useMemo(
    () => Array.from(new Set(stitches.map((s) => s.orgId))).sort((a, b) => a.localeCompare(b)),
    [stitches],
  );

  const filtered = useMemo(() => {
    return stitches.filter((s) => {
      if (orgFilter && s.orgId !== orgFilter) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [stitches, orgFilter, search]);

  function patchRowEdit(id: string, patch: Partial<RowEdit>) {
    setRowEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleRowSave(id: string) {
    const edit = rowEdits[id];
    if (!edit) return;
    const interval = Number.parseInt(edit.interval, 10);
    if (!Number.isInteger(interval) || interval <= 0) {
      patchRowEdit(id, { error: 'Enter a positive integer.' });
      return;
    }
    patchRowEdit(id, { saving: true, error: null, saved: false });
    try {
      const updated = await adminUpdateSchedule(id, { syncIntervalMinutes: interval });
      setStitches((prev) => prev.map((s) => (s.id === id ? updated : s)));
      patchRowEdit(id, { saving: false, saved: true });
    } catch (e: unknown) {
      patchRowEdit(id, {
        saving: false,
        error: e instanceof Error ? e.message : 'Save failed.',
      });
    }
  }

  function handleBulkApplyClick() {
    if (!bulkOrgId || !bulkInterval) return;
    const interval = Number.parseInt(bulkInterval, 10);
    if (!Number.isInteger(interval) || interval <= 0) {
      setBulkError('Enter a positive integer.');
      return;
    }
    setBulkError(null);
    setBulkConfirmOpen(true);
  }

  async function handleBulkSave() {
    if (!bulkOrgId || !bulkInterval) return;
    const interval = Number.parseInt(bulkInterval, 10);
    setBulkConfirmOpen(false);
    setBulkSaving(true);
    setBulkError(null);
    setBulkSaved(false);
    try {
      const updated = await adminBulkUpdateOrgSchedule(bulkOrgId, { syncIntervalMinutes: interval });
      setStitches((prev) => {
        const updatedMap = new Map(updated.map((u) => [u.id, u]));
        return prev.map((s) => updatedMap.get(s.id) ?? s);
      });
      // Sync row edits for affected stitches
      setRowEdits((prev) => {
        const next = { ...prev };
        updated.forEach((u) => {
          if (next[u.id]) {
            next[u.id] = { ...next[u.id], interval: String(u.syncIntervalMinutes), saved: false };
          }
        });
        return next;
      });
      setBulkSaved(true);
    } catch (e: unknown) {
      setBulkError(e instanceof Error ? e.message : 'Bulk update failed.');
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <GitMerge className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Stitches</h1>
      </div>

      {/* Bulk override panel */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <p className="text-sm font-medium">Bulk schedule override for org</p>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={bulkOrgId} onValueChange={setBulkOrgId}>
            <SelectTrigger className="w-64 h-8 text-sm">
              <SelectValue placeholder="Select org…" />
            </SelectTrigger>
            <SelectContent>
              {orgIds.map((id) => (
                <SelectItem key={id} value={id}>{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-28 h-8 text-sm"
            type="number"
            min={1}
            placeholder="Interval (min)"
            value={bulkInterval}
            onChange={(e) => { setBulkInterval(e.target.value); setBulkSaved(false); }}
          />
          <Button
            size="sm"
            disabled={bulkSaving || !bulkOrgId || !bulkInterval}
            onClick={handleBulkApplyClick}
          >
            {bulkSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Apply to all
          </Button>
          {bulkSaved && <span className="text-xs text-green-600">Updated.</span>}
          {bulkError && <span className="text-xs text-destructive">{bulkError}</span>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="All orgs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All orgs</SelectItem>
            {orgIds.map((id) => (
              <SelectItem key={id} value={id}>{id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-56 h-8 text-sm"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
        />
      </div>

      {/* Error */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stitches…
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Org</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Last synced</th>
                <th className="px-4 py-2 text-left w-52">Interval (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No stitches found.
                  </td>
                </tr>
              )}
              {filtered.map((stitch) => {
                const edit = rowEdits[stitch.id];
                return (
                  <tr key={stitch.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-[8rem]" title={stitch.orgId}>
                      {shortId(stitch.orgId)}…
                    </td>
                    <td className="px-4 py-2 font-medium">{stitch.name}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={stitchBadgeVariant(stitch.status)}
                        className="text-xs"
                      >
                        {stitch.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">
                      {lastSyncedLabel(stitch.lastScheduledAt)}
                    </td>
                    <td className="px-4 py-2">
                      {edit && (
                        <div className="flex items-center gap-2">
                          <Input
                            className="h-7 w-20 text-sm"
                            type="number"
                            min={1}
                            value={edit.interval}
                            aria-label={`Sync interval for ${stitch.name}`}
                            onChange={(e) => {
                              patchRowEdit(stitch.id, {
                                interval: e.target.value,
                                saved: false,
                                error: null,
                              });
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            disabled={edit.saving}
                            aria-label={`Save interval for ${stitch.name}`}
                            onClick={() => { void handleRowSave(stitch.id); }}
                          >
                            {edit.saving
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Save'}
                          </Button>
                          {edit.saved && <span className="text-xs text-green-600">✓</span>}
                          {edit.error && (
                            <span className="text-xs text-destructive">{edit.error}</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk override confirmation */}
      <Dialog open={bulkConfirmOpen} onOpenChange={(open) => { if (!open) setBulkConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply bulk schedule override?</DialogTitle>
            <DialogDescription>
              All active stitches for org <strong>{bulkOrgId ? shortId(bulkOrgId) : ''}…</strong> will
              be updated to a sync interval of <strong>{bulkInterval} min</strong>. This cannot be
              undone without applying another override.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkConfirmOpen(false); }}>
              Cancel
            </Button>
            <Button
              disabled={bulkSaving}
              onClick={() => { void handleBulkSave(); }}
            >
              {bulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
