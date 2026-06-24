import { useCallback, useEffect, useRef, useState } from 'react';
import isEqual from 'lodash.isequal';
import { useToast } from '@/shared/hooks/use-toast';
import { getStitch, updateStitch, type StitchResponse } from '../api/stitches.api';
import { bulkUpsertAndDeleteFieldMappings } from '../api/field-mappings.api';
import type { SyncConditionRule } from '../components/MappingCanvas';
import type { CanonicalMappingEntry } from '../components/MultiObjectMappingEditor';

export function useStitchDetailPage(id: string | undefined) {
  const { toast } = useToast();

  const [stitch, setStitch] = useState<StitchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancellingRef = useRef(false);

  const [togglingStatus, setTogglingStatus] = useState(false);

  const [configDraft, setConfigDraft] = useState<Record<string, unknown> | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [canonicalMappings, setCanonicalMappings] = useState<CanonicalMappingEntry[]>([]);
  const [syncConditions, setSyncConditions] = useState<SyncConditionRule[]>([]);
  const [savingMappings, setSavingMappings] = useState(false);
  const [mappingsDirty, setMappingsDirty] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getStitch(id);
        if (active) {
          setStitch(data);
          setNameDraft(data.name);
          setConfigDraft(data.config || {});
          
          const primaryFm = data.fieldMappings?.find((fm) => fm.sourceCanonical === data.canonicalObject);
          const secondaryFms = (data.fieldMappings ?? []).filter((fm) => fm.sourceCanonical !== data.canonicalObject);
          setCanonicalMappings([
            { sourceCanonical: data.canonicalObject, mappingRules: primaryFm?.mappingRules ?? [] },
            ...secondaryFms.map((fm) => ({ sourceCanonical: fm.sourceCanonical, mappingRules: fm.mappingRules })),
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

  const startEditingName = () => {
    if (!stitch) return;
    cancellingRef.current = false;
    setNameDraft(stitch.name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const cancelEditingName = () => {
    cancellingRef.current = true;
    setEditingName(false);
    setNameDraft(stitch?.name ?? '');
    setTimeout(() => {
      cancellingRef.current = false;
    }, 0);
  };

  const handleNameSave = async () => {
    if (savingName || cancellingRef.current || !stitch) return;
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
      toast({ title: 'Rename failed', description: e instanceof Error ? e.message : 'Could not rename stitch.', variant: 'destructive' });
    } finally {
      setSavingName(false);
    }
  };

  const handleStatusToggle = async () => {
    if (!stitch) return;
    const next = stitch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setTogglingStatus(true);
    try {
      const updated = await updateStitch(stitch.id, { status: next });
      setStitch(updated);
      toast({ title: next === 'ACTIVE' ? 'Stitch Resumed' : 'Stitch Paused' });
    } catch (e) {
      toast({ title: 'Status change failed', description: e instanceof Error ? e.message : 'Could not update status.', variant: 'destructive' });
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleMappingChange = useCallback((mappings: CanonicalMappingEntry[], conditions: SyncConditionRule[]) => {
    setCanonicalMappings(mappings);
    setSyncConditions(conditions);
    setMappingsDirty(true);
  }, []);

  const handleMappingSave = async () => {
    if (!stitch) return;
    setSavingMappings(true);
    try {
      const originalCanonicals = new Set((stitch.fieldMappings ?? []).map((fm) => fm.sourceCanonical));
      const currentWithRules = new Set(canonicalMappings.filter((e) => e.mappingRules.length > 0).map((e) => e.sourceCanonical));
      const toDelete = [...originalCanonicals].filter((c) => !currentWithRules.has(c));

      const toUpsert = canonicalMappings
        .filter((entry) => entry.mappingRules.length > 0)
        .map((entry) => ({ sourceCanonical: entry.sourceCanonical, mappingRules: entry.mappingRules }));

      await bulkUpsertAndDeleteFieldMappings(stitch.id, { toUpsert, toDelete });
      await updateStitch(stitch.id, { syncCondition: syncConditions });

      const refetchedStitch = await getStitch(stitch.id);
      setStitch(refetchedStitch);
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
      try {
        const freshStitch = await getStitch(stitch.id);
        setStitch(freshStitch);
      } catch (refetchErr) {
        console.error('Failed to refetch stitch after save error:', refetchErr);
      }
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Could not save mappings.', variant: 'destructive' });
    } finally {
      setSavingMappings(false);
    }
  };

  const handleConfigSave = async () => {
    if (!stitch || !configDraft) return;
    setSavingConfig(true);
    try {
      const updated = await updateStitch(stitch.id, { config: configDraft });
      setStitch(updated);
      setConfigDraft(updated.config || {});
      toast({ title: 'Configuration Saved', description: 'Advanced settings updated successfully.' });
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Could not save configuration.', variant: 'destructive' });
    } finally {
      setSavingConfig(false);
    }
  };

  const isConfigDirty = !isEqual(configDraft, stitch?.config || {});

  return {
    stitch,
    setStitch,
    loading,
    error,
    editingName,
    nameDraft,
    setNameDraft,
    savingName,
    nameInputRef,
    cancellingRef,
    togglingStatus,
    configDraft,
    setConfigDraft,
    savingConfig,
    canonicalMappings,
    syncConditions,
    savingMappings,
    mappingsDirty,
    isConfigDirty,
    startEditingName,
    cancelEditingName,
    handleNameSave,
    handleStatusToggle,
    handleMappingChange,
    handleMappingSave,
    handleConfigSave,
  };
}
