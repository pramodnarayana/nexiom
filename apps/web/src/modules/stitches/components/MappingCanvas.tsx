import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
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

const INITIAL_STATE: ComponentState = {
  fields: { src: [], dest: [], loading: true, error: null },
  canvas: { mappingRows: [newMappingRow()], conditionRows: [] },
};

function reducer(state: ComponentState, action: ComponentAction): ComponentState {
  switch (action.type) {
    case 'FETCH_START':
      return { fields: { src: [], dest: [], loading: true, error: null }, canvas: { mappingRows: [newMappingRow()], conditionRows: [] } };
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
  onChange,
}: Readonly<MappingCanvasProps>) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { fields, canvas } = state;

  useEffect(() => {
    dispatch({ type: 'FETCH_START' });
    let cancelled = false;
    Promise.all([
      listFields(srcConnectionId, sourceObject),
      listFields(destConnectionId, targetObject),
    ])
      .then(([src, dest]) => {
        if (!cancelled) dispatch({ type: 'FETCH_SUCCESS', src, dest });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          dispatch({ type: 'FETCH_ERROR', error: e instanceof Error ? e.message : 'Failed to load fields.' });
        }
      });
    return () => { cancelled = true; };
  }, [srcConnectionId, sourceObject, destConnectionId, targetObject]);

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
          <span />
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
      <div>
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
      </div>
    </div>
  );
}
