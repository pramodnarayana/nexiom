import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Combobox } from '@/shared/components/ui/combobox';
import { listFields, type FieldDescriptor } from '../api/metadata.api';
import type { MappingRule } from '../api/field-mappings.api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncConditionOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
export type SyncConditionLogic = 'AND' | 'OR';

export interface SyncConditionRule {
  field: string;
  op: SyncConditionOp;
  /** Value is always a string from UI inputs; the backend coerces to number or boolean as needed. */
  value: string;
  logic: SyncConditionLogic;
}

interface MappingRow {
  _id: string;
  src: string;
  dest: string;
  transform?: string;
}

interface ConditionRow {
  _id: string;
  field: string;
  op: SyncConditionOp;
  value: string;
  logic: SyncConditionLogic;
}

/** Combined canvas state — kept in a single object so state updater callbacks
 * can access both arrays from `prev` without capturing stale closures. */
interface CanvasState {
  mappingRows: MappingRow[];
  conditionRows: ConditionRow[];
}

export interface MappingCanvasProps {
  srcConnectionId: string;
  sourceObject: string;
  destConnectionId: string;
  targetObject: string;
  /**
   * Pre-populate mapping rows from saved data (edit flow).
   *
   * IMPORTANT: This prop is read ONLY ONCE on mount. Subsequent changes to
   * initialRules will be ignored. Callers must remount (key) the MappingCanvas
   * component to reset internal state.
   */
  initialRules?: MappingRule[];
  /**
   * Pre-populate sync-condition rows from saved data (edit flow).
   *
   * IMPORTANT: This prop is read ONLY ONCE on mount. Subsequent changes to
   * initialConditions will be ignored. Callers must remount (key) the
   * MappingCanvas component to reset internal state.
   */
  initialConditions?: SyncConditionRule[];
  /**
   * When true, the Sync Conditions section is hidden entirely.
   * Use this for secondary source-object tabs where conditions are owned
   * by the primary canonical and should not be duplicated.
   */
  hideConditions?: boolean;
  /**
   * Called whenever the user edits mapping rows or sync conditions.
   * Should be stable (memoized with useCallback in the parent) to avoid
   * unnecessary work; the component internally stabilises the reference via a
   * ref so stale-closure bugs are avoided even if the identity changes.
   */
  onChange: (rules: MappingRule[], conditions: SyncConditionRule[]) => void;
}

const OP_OPTIONS: { value: SyncConditionOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'contains', label: 'contains' },
];

function newMappingRow(): MappingRow {
  return { _id: crypto.randomUUID(), src: '', dest: '' };
}

function newConditionRow(): ConditionRow {
  return { _id: crypto.randomUUID(), field: '', op: 'eq', value: '', logic: 'AND' };
}

// ── State ─────────────────────────────────────────────────────────────────────

interface FieldsState {
  src: FieldDescriptor[];
  dest: FieldDescriptor[];
  loading: boolean;
  error: string | null;
}

interface ComponentState {
  fields: FieldsState;
  canvas: CanvasState;
}

type ComponentAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; src: FieldDescriptor[]; dest: FieldDescriptor[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'CANVAS'; update: (prev: CanvasState) => CanvasState };


function reducer(state: ComponentState, action: ComponentAction): ComponentState {
  switch (action.type) {
    case 'FETCH_START':
      // Reset field lists only — preserve canvas rows so seeded initial values
      // from the edit flow survive connection/object changes initiated externally.
      return { ...state, fields: { src: [], dest: [], loading: true, error: null } };
    case 'FETCH_SUCCESS':
      return { ...state, fields: { src: action.src, dest: action.dest, loading: false, error: null } };
    case 'FETCH_ERROR':
      return { ...state, fields: { src: [], dest: [], loading: false, error: action.error } };
    case 'CANVAS':
      return { ...state, canvas: action.update(state.canvas) };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MappingCanvas({
  srcConnectionId,
  sourceObject,
  destConnectionId,
  targetObject,
  initialRules,
  initialConditions,
  hideConditions = false,
  onChange,
}: Readonly<MappingCanvasProps>) {
  // Seed canvas from saved data when provided (edit flow).
  // We compute the initial state once so the reducer starts pre-populated.
  const computedInitial = useMemo<ComponentState>(() => {
    const mappingRows: MappingRow[] = initialRules && initialRules.length > 0
      ? initialRules.map((r) => ({ _id: crypto.randomUUID(), src: r.src, dest: r.dest, transform: r.transform }))
      : [newMappingRow()];
    const conditionRows: ConditionRow[] = initialConditions && initialConditions.length > 0
      ? initialConditions.map((c) => ({ _id: crypto.randomUUID(), field: c.field, op: c.op, value: String(c.value), logic: c.logic }))
      : [];
    return {
      fields: { src: [], dest: [], loading: true, error: null },
      canvas: { mappingRows, conditionRows },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — seed is applied only on first mount

  const [state, dispatch] = useReducer(reducer, computedInitial);
  const { fields, canvas } = state;

  // ── Field fetch (initial + manual refresh) ───────────────────────────────

  const [refreshToken, setRefreshToken] = useState(0);

  const doFetch = useCallback((forceRefresh: boolean) => {
    dispatch({ type: 'FETCH_START' });
    let cancelled = false;
    Promise.all([
      listFields(srcConnectionId, sourceObject, forceRefresh),
      listFields(destConnectionId, targetObject, forceRefresh),
    ])
      .then(([src, dest]) => {
        // DEBUG — remove after verifying fields are correct
        console.log('[MappingCanvas] src fields:', src.length, src.map((f) => f.name));
        console.log('[MappingCanvas] dest fields:', dest.length, dest.map((f) => f.name));
        if (!cancelled) dispatch({ type: 'FETCH_SUCCESS', src, dest });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          dispatch({ type: 'FETCH_ERROR', error: e instanceof Error ? e.message : 'Failed to load fields.' });
        }
      });
    return () => { cancelled = true; };
  }, [srcConnectionId, sourceObject, destConnectionId, targetObject]);

  useEffect(() => {
    return doFetch(refreshToken > 0);
  // refreshToken being in deps means re-running with forceRefresh=true when user clicks refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcConnectionId, sourceObject, destConnectionId, targetObject, refreshToken]);

  const handleRefresh = useCallback(() => {
    setRefreshToken((t) => t + 1);
  }, []);

  // Stabilise onChange so the canvas-sync effect below does not re-run every
  // time the parent re-creates its callback.  The ref is always kept current so
  // calling onChangeRef.current(...) never produces a stale-closure bug.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Sync parent whenever canvas changes.
  // Skips the initial mount to avoid calling onChange (→ setWizard in parent)
  // during the first render, which triggers React's "update while rendering" warning.
  // onChange is intentionally omitted from deps — stabilised via onChangeRef above.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const rules: MappingRule[] = canvas.mappingRows
      .filter((r) => r.src && r.dest)
      .map(({ src, dest, transform }) => ({ src, dest, transform }));
    const conds: SyncConditionRule[] = canvas.conditionRows
      .filter((c) => c.field && c.value)
      .map(({ field, op, value, logic }) => ({ field, op, value, logic }));
    onChangeRef.current(rules, conds);
  }, [canvas]);  

  // ── Mapping row handlers ─────────────────────────────────────────────────

  function updateMappingRow(id: string, patch: Partial<Pick<MappingRow, 'src' | 'dest' | 'transform'>>) {
    dispatch({ type: 'CANVAS', update: (prev) => ({
      ...prev,
      mappingRows: prev.mappingRows.map((r) => (r._id === id ? { ...r, ...patch } : r)),
    }) });
  }

  function addMappingRow() {
    dispatch({ type: 'CANVAS', update: (prev) => ({ ...prev, mappingRows: [...prev.mappingRows, newMappingRow()] }) });
  }

  function removeMappingRow(id: string) {
    dispatch({ type: 'CANVAS', update: (prev) => {
      const next = prev.mappingRows.filter((r) => r._id !== id);
      return { ...prev, mappingRows: next.length > 0 ? next : [newMappingRow()] };
    } });
  }

  // ── Condition row handlers ───────────────────────────────────────────────

  function updateConditionRow(id: string, patch: Partial<Omit<ConditionRow, '_id'>>) {
    dispatch({ type: 'CANVAS', update: (prev) => ({
      ...prev,
      conditionRows: prev.conditionRows.map((r) => (r._id === id ? { ...r, ...patch } : r)),
    }) });
  }

  function addConditionRow() {
    dispatch({ type: 'CANVAS', update: (prev) => ({ ...prev, conditionRows: [...prev.conditionRows, newConditionRow()] }) });
  }

  function removeConditionRow(id: string) {
    dispatch({ type: 'CANVAS', update: (prev) => ({
      ...prev,
      conditionRows: prev.conditionRows.filter((r) => r._id !== id),
    }) });
  }

  const srcFieldOptions = useMemo(
    () => fields.src.map((f) => ({ value: f.name, label: f.label || f.name })),
    [fields.src],
  );
  const destFieldOptions = useMemo(
    () => fields.dest.map((f) => ({ value: f.name, label: f.label || f.name })),
    [fields.dest],
  );

  if (fields.loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading fields…
      </div>
    );
  }

  if (fields.error) {
    return (
      <p className="py-4 text-sm text-destructive">{fields.error}</p>
    );
  }

  const { mappingRows, conditionRows } = canvas;

  return (
    <div className="space-y-6">
      {/* ── Field Mappings ────────────────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Source — {sourceObject}
          </p>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Transformation (JSONata)
          </p>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Destination — {targetObject}
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={fields.loading}
            title="Refresh field list from connector"
            className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            aria-label="Refresh fields"
          >
            <RotateCcw className={`h-3 w-3 ${fields.loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="space-y-2">
          {mappingRows.map((row) => (
            <div key={row._id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <Combobox
                options={srcFieldOptions}
                value={row.src}
                onValueChange={(v) => { updateMappingRow(row._id, { src: v }); }}
                placeholder="Source field"
                searchPlaceholder="Search source fields…"
                emptyMessage="No matching fields."
                className="h-8 text-sm"
              />

              <Select
                value={row.transform || 'none'}
                onValueChange={(v) => { updateMappingRow(row._id, { transform: v === 'none' ? undefined : v }); }}
              >
                <SelectTrigger className="h-8 text-sm font-mono">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="$uppercase($)" className="font-mono">$uppercase($)</SelectItem>
                  <SelectItem value="$lowercase($)" className="font-mono">$lowercase($)</SelectItem>
                  <SelectItem value="$trim($)" className="font-mono">$trim($)</SelectItem>
                </SelectContent>
              </Select>

              <Combobox
                options={destFieldOptions}
                value={row.dest}
                onValueChange={(v) => { updateMappingRow(row._id, { dest: v }); }}
                placeholder="Destination field"
                searchPlaceholder="Search destination fields…"
                emptyMessage="No matching fields."
                className="h-8 text-sm"
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove mapping row"
                onClick={() => { removeMappingRow(row._id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={addMappingRow}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add mapping row
        </Button>
      </div>

      {/* ── Sync Conditions ───────────────────────────────────────────────── */}
      {!hideConditions && <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Sync Conditions
        </p>

        {conditionRows.length === 0 && (
          <p className="text-xs text-muted-foreground italic mb-2">
            No conditions — all records will sync.
          </p>
        )}

        <div className="space-y-2">
          {conditionRows.map((row, idx) => (
            <div key={row._id} className="flex items-center gap-2">
              {idx > 0 && (
                <Select
                  value={row.logic}
                  onValueChange={(v) => {
                    updateConditionRow(row._id, { logic: v as SyncConditionLogic });
                  }}
                >
                  <SelectTrigger className="h-8 w-16 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">AND</SelectItem>
                    <SelectItem value="OR">OR</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {idx === 0 && <span className="w-16 shrink-0" />}

              <Combobox
                options={srcFieldOptions}
                value={row.field}
                onValueChange={(v) => { updateConditionRow(row._id, { field: v }); }}
                placeholder="Source field"
                searchPlaceholder="Search fields…"
                emptyMessage="No matching fields."
                className="h-8 text-sm"
              />

              <Select
                value={row.op}
                onValueChange={(v) => {
                  updateConditionRow(row._id, { op: v as SyncConditionOp });
                }}
              >
                <SelectTrigger className="h-8 w-24 text-sm shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OP_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                className="h-8 text-sm"
                placeholder="Value"
                value={row.value}
                onChange={(e) => { updateConditionRow(row._id, { value: e.target.value }); }}
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove condition"
                onClick={() => { removeConditionRow(row._id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={addConditionRow}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Condition
        </Button>
      </div>}
    </div>
  );
}