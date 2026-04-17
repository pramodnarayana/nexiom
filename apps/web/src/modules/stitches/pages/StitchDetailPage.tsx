import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pause, Pencil, Play, Save, X } from 'lucide-react';
import isEqual from 'lodash.isequal';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/shared/components/ui/card';
import { useToast } from '@/shared/hooks/use-toast';

import { getStitch, updateStitch, type StitchResponse } from '../api/stitches.api';
import { upsertFieldMapping, deleteFieldMapping } from '../api/field-mappings.api';
import { SchedulePanel } from '../components/SchedulePanel';
import { DependencyList } from '../components/DependencyList';
import { StitchConfigPanel } from '../components/StitchConfigPanel';
import { type SyncConditionRule } from '../components/MappingCanvas';
import {
  MultiObjectMappingEditor,
  type CanonicalMappingEntry,
} from '../components/MultiObjectMappingEditor';


export function StitchDetailPage() {
  const { id: workspaceId, stitchId: id } = useParams<{ id: string; stitchId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stitch, setStitch] = useState<StitchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline name-edit state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Prevents onBlur from saving when the user clicks the Cancel (✕) button:
  // mousedown on Cancel sets this flag before the input's blur event fires.
  const cancellingRef = useRef(false);

  // Status toggle state
  const [togglingStatus, setTogglingStatus] = useState(false);

  // Configuration drafting state
  const [configDraft, setConfigDraft] = useState<Record<string, unknown> | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Field-mapping draft state — one entry per source canonical.
  // The first entry is always the primary object (stitch.sourceObject).
  const [canonicalMappings, setCanonicalMappings] = useState<CanonicalMappingEntry[]>([]);
  const [syncConditions, setSyncConditions] = useState<SyncConditionRule[]>([]);
  const [savingMappings, setSavingMappings] = useState(false);
  const [mappingsDirty, setMappingsDirty] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getStitch(id);
        if (active) {
          setStitch(data);
          setNameDraft(data.name);
          setConfigDraft(data.config || {});
          // Build the canonical mapping list:
          //   1. Primary entry always first (ensures the tab ordering is stable).
          //   2. Any additional canonicals that were previously saved follow.
          const primaryFm = data.fieldMappings?.find(
            (fm) => fm.sourceCanonical === data.sourceObject,
          );
          const secondaryFms = (data.fieldMappings ?? []).filter(
            (fm) => fm.sourceCanonical !== data.sourceObject,
          );
          setCanonicalMappings([
            { sourceCanonical: data.sourceObject, mappingRules: primaryFm?.mappingRules ?? [] },
            ...secondaryFms.map((fm) => ({
              sourceCanonical: fm.sourceCanonical,
              mappingRules: fm.mappingRules,
            })),
          ]);
          setSyncConditions(
            (data.syncCondition ?? []).map((c) => ({
              field: c.field,
              op: c.op,
              value: String(c.value),
              logic: (c.logic ?? 'AND') as 'AND' | 'OR',
            }))
          );
          setMappingsDirty(false);
        }
      } catch (e: unknown) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load stitch.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id]);

  // ── Name editing ────────────────────────────────────────────────────────────

  const startEditingName = () => {
    if (!stitch) return;
    cancellingRef.current = false;
    setNameDraft(stitch.name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const cancelEditingName = () => {
    cancellingRef.current = false;
    setEditingName(false);
    setNameDraft(stitch?.name ?? '');
  };

  const handleNameSave = async () => {
    if (cancellingRef.current) return; // Cancel button mousedown beat onBlur
    if (!stitch) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === stitch.name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const updated = await updateStitch(stitch.id, { name: trimmed });
      setStitch(updated);
      setNameDraft(updated.name);
      setEditingName(false);
      toast({ title: 'Renamed', description: `Stitch renamed to "${updated.name}".` });
    } catch (e) {
      toast({
        title: 'Rename failed',
        description: e instanceof Error ? e.message : 'Could not rename stitch.',
        variant: 'destructive',
      });
    } finally {
      setSavingName(false);
    }
  };

  // ── Status toggle ────────────────────────────────────────────────────────────

  const handleStatusToggle = async () => {
    if (!stitch) return;
    const next = stitch.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setTogglingStatus(true);
    try {
      const updated = await updateStitch(stitch.id, { status: next });
      setStitch(updated);
      toast({ title: next === 'ACTIVE' ? 'Stitch Resumed' : 'Stitch Paused' });
    } catch (e) {
      toast({
        title: 'Status change failed',
        description: e instanceof Error ? e.message : 'Could not update status.',
        variant: 'destructive',
      });
    } finally {
      setTogglingStatus(false);
    }
  };

  // ── Mapping save ─────────────────────────────────────────────────────────────

  const handleMappingChange = useCallback(
    (mappings: CanonicalMappingEntry[], conditions: SyncConditionRule[]) => {
      setCanonicalMappings(mappings);
      setSyncConditions(conditions);
      setMappingsDirty(true);
    },
    [],
  );

  const handleMappingSave = async () => {
    if (!stitch) return;
    setSavingMappings(true);
    try {
      // ── Compute what needs to be written vs deleted ──────────────────────
      //
      // toUpsert: canonicals that currently have rules (new or changed)
      // toDelete: canonicals that were previously saved in the DB but are now
      //   either removed from the editor OR have had all their rules cleared.
      //   We must delete them explicitly because the backend rejects empty-rule
      //   upserts (min(1) validation on mappingRules).
      const originalCanonicals = new Set(
        (stitch.fieldMappings ?? []).map((fm) => fm.sourceCanonical),
      );
      const currentWithRules = new Set(
        canonicalMappings
          .filter((e) => e.mappingRules.length > 0)
          .map((e) => e.sourceCanonical),
      );
      const toDelete = [...originalCanonicals].filter(
        (c) => !currentWithRules.has(c),
      );

      // Safe ordering to prevent partial updates on failure:
      // 1. Delete orphaned canonicals first
      // 2. Upsert current canonicals
      // 3. Update sync conditions
      // If any step fails, we refetch to reconcile UI state.
      await Promise.all(toDelete.map((canonical) => deleteFieldMapping(stitch.id, canonical)));

      await Promise.all(
        canonicalMappings
          .filter((entry) => entry.mappingRules.length > 0)
          .map((entry) =>
            upsertFieldMapping(stitch.id, {
              sourceCanonical: entry.sourceCanonical,
              mappingRules: entry.mappingRules,
            }),
          ),
      );

      const updatedStitch = await updateStitch(stitch.id, { syncCondition: syncConditions });

      // Refresh local state with the returned stitch to prevent stale canonicals.
      setStitch(updatedStitch);
      setMappingsDirty(false);

      const totalRules = canonicalMappings.reduce((sum, e) => sum + e.mappingRules.length, 0);
      const activeObjects = canonicalMappings.filter((e) => e.mappingRules.length > 0).length;
      toast({
        title: 'Mappings Saved',
        description: `${totalRules} rule${totalRules !== 1 ? 's' : ''} across ${activeObjects} object${activeObjects !== 1 ? 's' : ''} saved.${
          toDelete.length > 0 ? ` ${toDelete.length} removed object${toDelete.length !== 1 ? 's' : ''} cleared.` : ''
        }`,
      });
    } catch (e) {
      // On error, refetch the stitch to reconcile UI state with the server.
      try {
        const freshStitch = await getStitch(stitch.id);
        setStitch(freshStitch);
      } catch (refetchErr) {
        // If refetch also fails, log but don't block the error toast.
        console.error('Failed to refetch stitch after save error:', refetchErr);
      }
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Could not save mappings.',
        variant: 'destructive',
      });
    } finally {
      setSavingMappings(false);
    }
  };

  // ── Config save ──────────────────────────────────────────────────────────────

  const handleConfigSave = async () => {
    if (!stitch || !configDraft) return;
    setSavingConfig(true);
    try {
      const updated = await updateStitch(stitch.id, { config: configDraft });
      setStitch(updated);
      setConfigDraft(updated.config || {});
      toast({ title: 'Configuration Saved', description: 'Advanced settings updated successfully.' });
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Could not save configuration.',
        variant: 'destructive',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Loading execution context...</p>
      </div>
    );
  }

  if (error || !stitch) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md border border-destructive/20 mb-4">
          {error || 'Stitch not found.'}
        </div>
        <Button variant="outline" onClick={() => navigate(`/dashboard/workspaces/${workspaceId}/stitches`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to list
        </Button>
      </div>
    );
  }

  // Determine if config changed
  const isConfigDirty = !isEqual(configDraft, stitch.config || {});

  return (
    <div className="container py-8 max-w-5xl space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/dashboard/workspaces/${workspaceId}/stitches`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            {/* ── Inline name edit ── */}
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <input
                    ref={nameInputRef}
                    className="text-2xl font-semibold tracking-tight bg-transparent border-b-2 border-primary focus:outline-none w-64"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleNameSave();
                      if (e.key === 'Escape') cancelEditingName();
                    }}
                    onBlur={() => void handleNameSave()}
                    disabled={savingName}
                    autoFocus
                  />
                  {savingName
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : (
                      <>
                        <button type="button" onClick={() => void handleNameSave()} className="text-primary hover:text-primary/80" aria-label="Save name"><Check className="h-4 w-4" /></button>
                        <button
                          type="button"
                          onMouseDown={() => { cancellingRef.current = true; }}
                          onClick={cancelEditingName}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )
                  }
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">{stitch.name}</h1>
                  <button
                    type="button"
                    onClick={startEditingName}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Rename stitch"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </>
              )}
              <Badge variant={stitch.status === 'ACTIVE' ? 'default' : 'secondary'}>{stitch.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Syncing {stitch.sourceObject} → {stitch.targetObject}
            </p>
          </div>
        </div>
        {/* ── Status toggle ── */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleStatusToggle()}
          disabled={togglingStatus || stitch.status === 'ARCHIVED'}
          className="gap-2"
        >
          {togglingStatus
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : stitch.status === 'ACTIVE'
              ? <Pause className="h-4 w-4" />
              : <Play className="h-4 w-4" />
          }
          {stitch.status === 'ACTIVE' ? 'Pause' : 'Resume'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-8 space-y-8">
          <Card className="border shadow-sm">
            <CardHeader className="py-4 border-b bg-muted/20">
              <CardTitle className="text-lg font-semibold flex items-center justify-between">
                <span>Field Mappings</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {stitch && canonicalMappings.length > 0 && (
                <MultiObjectMappingEditor
                  key={stitch.id}
                  srcConnectionId={stitch.srcConnectionId}
                  destConnectionId={stitch.destConnectionId}
                  primaryObject={stitch.sourceObject}
                  targetObject={stitch.targetObject}
                  initialMappings={canonicalMappings}
                  initialConditions={syncConditions}
                  onChange={handleMappingChange}
                />
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4">
              <div className="flex items-center gap-3 w-full justify-between">
                <span className="text-xs text-muted-foreground">
                  Changes take effect on the next sync execution.
                </span>
                <Button onClick={() => void handleMappingSave()} disabled={!mappingsDirty || savingMappings}>
                  {savingMappings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Mappings
                </Button>
              </div>
            </CardFooter>
          </Card>
          
          <Card className="border shadow-sm">
            <CardHeader className="py-4 border-b bg-muted/20">
              <CardTitle className="text-lg font-semibold flex items-center justify-between">
                <span>Advanced Configuration</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {configDraft && (
                <StitchConfigPanel
                  connectionId={stitch.srcConnectionId}
                  value={configDraft}
                  onChange={setConfigDraft}
                />
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4 justify-end">
               <div className="flex items-center gap-3 w-full justify-between">
                 <span className="text-xs text-muted-foreground">Changes to configuration will take effect on the next execution.</span>
                 <Button onClick={handleConfigSave} disabled={!isConfigDirty || savingConfig}>
                   {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                   Save Changes
                 </Button>
               </div>
            </CardFooter>
          </Card>
        </div>

        <div className="md:col-span-4 space-y-8">
          <SchedulePanel stitch={stitch} onUpdated={setStitch} />
          <DependencyList 
            connectionId={stitch.srcConnectionId}
            objectName={stitch.sourceObject}
            selected={(configDraft?.selectedRelatedObjects as string[]) || []}
            onSelectionChange={(selected) => setConfigDraft(prev => ({ ...(prev || {}), selectedRelatedObjects: selected }))}
          />
        </div>
      </div>
    </div>
  );
}