import { useEffect, useMemo, useState } from 'react';
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

// ── Component ─────────────────────────────────────────────────────────────────

export function MappingCanvas({
  srcConnectionId,
  sourceObject,
  destConnectionId,
  targetObject,
  onChange,
}: Readonly<MappingCanvasProps>) {
  interface FieldsState {
    src: FieldDescriptor[];
    dest: FieldDescriptor[];
    loading: boolean;
    error: string | null;
  }
  const [fields, setFields] = useState<FieldsState>({
    src: [],
    dest: [],
    loading: true,
    error: null,
  });

  const [canvas, setCanvas] = useState<CanvasState>({
    mappingRows: [newMappingRow()],
    conditionRows: [],
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listFields(srcConnectionId, sourceObject),
      listFields(destConnectionId, targetObject),
    ])
      .then(([src, dest]) => {
        if (!cancelled) setFields({ src, dest, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFields({
            src: [],
            dest: [],
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load fields.',
          });
        }
      });
    return () => { cancelled = true; };
  }, [srcConnectionId, sourceObject, destConnectionId, targetObject]);

  // Sync parent whenever canvas changes.
  // Kept in a useEffect so state updaters stay pure (no side-effects inside setCanvas).
  useEffect(() => {
    const rules: MappingRule[] = canvas.mappingRows
      .filter((r) => r.src && r.dest)
      .map(({ src, dest }) => ({ src, dest }));
    const conds: SyncConditionRule[] = canvas.conditionRows
      .filter((c) => c.field && c.value)
      .map(({ field, op, value, logic }) => ({ field, op, value, logic }));
    onChange(rules, conds);
  }, [canvas, onChange]);

  // ── Mapping row handlers ─────────────────────────────────────────────────

  function updateMappingRow(id: string, patch: Partial<Pick<MappingRow, 'src' | 'dest'>>) {
    setCanvas((prev) => ({
      ...prev,
      mappingRows: prev.mappingRows.map((r) => (r._id === id ? { ...r, ...patch } : r)),
    }));
  }

  function addMappingRow() {
    setCanvas((prev) => ({ ...prev, mappingRows: [...prev.mappingRows, newMappingRow()] }));
  }

  function removeMappingRow(id: string) {
    setCanvas((prev) => {
      const next = prev.mappingRows.filter((r) => r._id !== id);
      return { ...prev, mappingRows: next.length > 0 ? next : [newMappingRow()] };
    });
  }

  // ── Condition row handlers ───────────────────────────────────────────────

  function updateConditionRow(id: string, patch: Partial<Omit<ConditionRow, '_id'>>) {
    setCanvas((prev) => ({
      ...prev,
      conditionRows: prev.conditionRows.map((r) => (r._id === id ? { ...r, ...patch } : r)),
    }));
  }

  function addConditionRow() {
    setCanvas((prev) => ({ ...prev, conditionRows: [...prev.conditionRows, newConditionRow()] }));
  }

  function removeConditionRow(id: string) {
    setCanvas((prev) => ({
      ...prev,
      conditionRows: prev.conditionRows.filter((r) => r._id !== id),
    }));
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
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Source — {sourceObject}
          </p>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Destination — {targetObject}
          </p>
          <span />
        </div>

        <div className="space-y-2">
          {mappingRows.map((row) => (
            <div key={row._id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <Combobox
                options={srcFieldOptions}
                value={row.src}
                onValueChange={(v) => { updateMappingRow(row._id, { src: v }); }}
                placeholder="Source field"
                searchPlaceholder="Search source fields…"
                emptyMessage="No matching fields."
                className="h-8 text-sm"
              />

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
