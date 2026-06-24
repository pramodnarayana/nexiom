import { useEffect, useMemo, useState } from 'react';
import { GitMerge, Loader2 } from 'lucide-react';
import { Input } from '@/shared/components/ui/input';
import { Badge } from '@/shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { apiClient } from '@/shared/lib/api-client';
import type { StitchResponse } from '@/modules/stitches/api/stitches.api';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Renders first 8 hex chars of a UUID for compact display. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function stitchBadgeVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'ACTIVE') return 'default';
  if (status === 'INACTIVE') return 'secondary';
  return 'outline';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminStitchesPage() {
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Sentinel value meaning "no org filter applied" — avoids empty-string SelectItem. */
  const ALL_ORGS = '__ALL__';

  // Client-side filters
  const [orgFilter, setOrgFilter] = useState<string>(ALL_ORGS);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiClient.get<StitchResponse[]>('/admin/stitches')
      .then((res) => setStitches(res.data))
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
      if (orgFilter !== ALL_ORGS && s.orgId !== orgFilter) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [stitches, orgFilter, search]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <GitMerge className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Stitches</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="All orgs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ORGS}>All orgs</SelectItem>
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
                <th className="px-4 py-2 text-left">Source Object</th>
                <th className="px-4 py-2 text-left">Target Object</th>
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
              {filtered.map((stitch) => (
                <tr key={stitch.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground max-w-[8rem]" title={stitch.orgId}>
                    {shortId(stitch.orgId)}…
                  </td>
                  <td className="px-4 py-2 font-medium">{stitch.name}</td>
                  <td className="px-4 py-2">
                    <Badge variant={stitchBadgeVariant(stitch.status)} className="text-xs">
                      {stitch.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{stitch.canonicalObject}</td>
                  <td className="px-4 py-2 font-mono text-xs">{stitch.targetObject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
