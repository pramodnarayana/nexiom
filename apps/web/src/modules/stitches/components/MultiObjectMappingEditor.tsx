import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { Combobox } from '@/shared/components/ui/combobox';
import { listObjects, type ObjectDescriptor } from '../api/metadata.api';
import { MappingCanvas, type SyncConditionRule } from './MappingCanvas';
import type { MappingRule } from '../api/field-mappings.api';

// ── Public types ──────────────────────────────────────────────────────────────

/** One source object's complete field-mapping configuration. */
export interface CanonicalMappingEntry {
  /** The source object name, e.g. "Account" or "TransportationProfile". */
  sourceCanonical: string;
  mappingRules: MappingRule[];
}

export interface MultiObjectMappingEditorProps {
  srcConnectionId: string;
  destConnectionId: string;
  /**
   * The primary source object defined on the stitch (e.g. "Account").
   * This tab is always present and cannot be removed.
   */
  primaryObject: string;
  targetObject: string;
  /**
   * Initial mapping entries — one per source canonical.
   * The first entry MUST be for primaryObject; upstream sorts it that way.
   *
   * IMPORTANT: Read-only on mount — consumers must key this component to reset.
   */
  initialMappings: CanonicalMappingEntry[];
  /**
   * Sync conditions always belong to the primary canonical.
   *
   * IMPORTANT: Read-only on mount — consumers must key this component to reset.
   */
  initialConditions: SyncConditionRule[];
  /**
   * Fired whenever ANY canonical's rules or the sync conditions change.
   * Stable-ised internally via a ref so the parent can pass an inline arrow
   * function without causing infinite re-renders.
   */
  onChange: (mappings: CanonicalMappingEntry[], conditions: SyncConditionRule[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MultiObjectMappingEditor({
  srcConnectionId,
  destConnectionId,
  primaryObject,
  targetObject,
  initialMappings,
  initialConditions,
  onChange,
}: MultiObjectMappingEditorProps) {
  // Local copies — owned by this component; parent receives them via onChange.
  const [mappings, setMappings] = useState<CanonicalMappingEntry[]>(initialMappings);
  const [conditions, setConditions] = useState<SyncConditionRule[]>(initialConditions);
  const [activeTab, setActiveTab] = useState(primaryObject);

  // Object-picker state
  const [showObjectPicker, setShowObjectPicker] = useState(false);
  const [availableObjects, setAvailableObjects] = useState<ObjectDescriptor[]>([]);
  const [availableObjectsTimestamp, setAvailableObjectsTimestamp] = useState<number>(0);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [objectError, setObjectError] = useState<string | null>(null);

  // ── Stable refs to avoid stale closures ─────────────────────────────────────

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // conditionsRef lets the handleCanvasChange callback always read the current
  // conditions without adding it to the useCallback dependency array.
  const conditionsRef = useRef(conditions);
  useEffect(() => { conditionsRef.current = conditions; }, [conditions]);

  // ── Object picker helpers ────────────────────────────────────────────────────

  const existingCanonicals = useMemo(
    () => new Set(mappings.map((m) => m.sourceCanonical)),
    [mappings],
  );

  const pickerOptions = useMemo(
    () =>
      availableObjects
        .filter((o) => !existingCanonicals.has(o.name))
        .map((o) => ({ value: o.name, label: o.label || o.name })),
    [availableObjects, existingCanonicals],
  );

  const handleLoadObjects = async (forceRefresh = false) => {
    setObjectError(null);
    // Re-use the cached list if already fetched and not stale (< 300 seconds).
    const now = Date.now();
    const isStale = now - availableObjectsTimestamp > 300_000;
    if (availableObjects.length > 0 && !forceRefresh && !isStale) {
      setShowObjectPicker(true);
      return;
    }
    setLoadingObjects(true);
    try {
      const objects = await listObjects(srcConnectionId, { refresh: forceRefresh || isStale });
      setAvailableObjects(objects);
      setAvailableObjectsTimestamp(now);
      setShowObjectPicker(true);
    } catch (e) {
      setObjectError(e instanceof Error ? e.message : 'Failed to load objects.');
    } finally {
      setLoadingObjects(false);
    }
  };

  const addSourceObject = (objectName: string) => {
    const entry: CanonicalMappingEntry = { sourceCanonical: objectName, mappingRules: [] };
    setMappings((prev) => {
      const next = [...prev, entry];
      onChangeRef.current(next, conditionsRef.current);
      return next;
    });
    setActiveTab(objectName);
    setShowObjectPicker(false);
  };

  const removeSourceObject = (canonical: string) => {
    if (canonical === primaryObject) return; // primary is immutable
    setMappings((prev) => {
      const next = prev.filter((m) => m.sourceCanonical !== canonical);
      onChangeRef.current(next, conditionsRef.current);
      return next;
    });
    // Use functional setter so we never read stale activeTab from the closure.
    setActiveTab((prev) => (prev === canonical ? primaryObject : prev));
  };

  // ── Per-canonical canvas change handler ─────────────────────────────────────

  /**
   * Returns a stable callback for a given canonical.
   * - Primary canonical: updates both its mapping rules and sync conditions.
   * - Secondary canonicals: updates only its mapping rules; conditions are
   *   hidden and preserved from the primary.
   *
   * useCallback deps are intentionally minimal — we use refs for values that
   * change frequently (conditions) to avoid re-creating all handlers on every
   * condition keystroke.
   */
  const handleCanvasChange = useCallback(
    (canonical: string, isPrimary: boolean) =>
      (rules: MappingRule[], conds: SyncConditionRule[]) => {
        const nextConditions = isPrimary ? conds : conditionsRef.current;
        if (isPrimary) {
          setConditions(nextConditions);
          conditionsRef.current = nextConditions;
        }
        setMappings((prev) => {
          const next = prev.map((m) =>
            m.sourceCanonical === canonical ? { ...m, mappingRules: rules } : m,
          );
          onChangeRef.current(next, nextConditions);
          return next;
        });
      },
    [], // no deps — all mutable values accessed via refs or functional setState
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* ── Tab strip + "Add Source Object" button ────────────────────────── */}
        <div className="flex items-start gap-3">
          <TabsList className="flex-1 h-auto flex-wrap justify-start gap-1 p-1">
            {mappings.map((entry) => {
              const isPrimary = entry.sourceCanonical === primaryObject;
              const ruleCount = entry.mappingRules.length;
              return (
                <div key={entry.sourceCanonical} className="flex items-center">
                  <TabsTrigger
                    value={entry.sourceCanonical}
                    className="text-xs h-7 flex items-center gap-1.5 max-w-[160px]"
                  >
                    <span className="truncate">{entry.sourceCanonical}</span>
                    {ruleCount > 0 && (
                      <span className="bg-primary/15 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0">
                        {ruleCount}
                      </span>
                    )}
                    {isPrimary && (
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
                        primary
                      </span>
                    )}
                  </TabsTrigger>
                  {!isPrimary && (
                    <button
                      type="button"
                      // Prevent the tab from losing focus before the click registers.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => removeSourceObject(entry.sourceCanonical)}
                      className="-ml-1 p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${entry.sourceCanonical} mapping`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </TabsList>

          <div className="shrink-0 flex items-center gap-2 pt-0.5">
            {showObjectPicker ? (
              <>
                <Combobox
                  options={pickerOptions}
                  value=""
                  onValueChange={addSourceObject}
                  placeholder="Pick an object…"
                  searchPlaceholder="Search objects…"
                  emptyMessage="No more objects available."
                  className="w-52 h-8 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowObjectPicker(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => void handleLoadObjects()}
                disabled={loadingObjects}
              >
                {loadingObjects ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Add Source Object
              </Button>
            )}
          </div>
        </div>

        {objectError && (
          <p className="text-xs text-destructive px-1 mt-1">{objectError}</p>
        )}

        {/* ── Tab panes ─────────────────────────────────────────────────────── */}
        {mappings.map((entry) => {
          const isPrimary = entry.sourceCanonical === primaryObject;
          return (
            <TabsContent
              key={entry.sourceCanonical}
              value={entry.sourceCanonical}
              className="outline-none mt-4"
            >
              {!isPrimary && (
                <p className="text-xs text-muted-foreground bg-muted/30 border rounded-md px-3 py-2 mb-4">
                  Fields from{' '}
                  <strong className="font-semibold text-foreground">
                    {entry.sourceCanonical}
                  </strong>{' '}
                  supplement the primary mapping. They are fetched from the same source
                  connection during each sync run and merged into the destination record.
                  Sync conditions are configured on the primary object tab.
                </p>
              )}
              <MappingCanvas
                srcConnectionId={srcConnectionId}
                sourceObject={entry.sourceCanonical}
                destConnectionId={destConnectionId}
                targetObject={targetObject}
                initialRules={entry.mappingRules}
                initialConditions={isPrimary ? conditions : []}
                hideConditions={!isPrimary}
                onChange={handleCanvasChange(entry.sourceCanonical, isPrimary)}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}