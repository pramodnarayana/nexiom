import { Button } from '@/shared/components/ui/button';
import { Plus, X } from 'lucide-react';
import { Combobox } from '@/shared/components/ui/combobox';
import { useMemo } from 'react';

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'startsWith';

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface FilterGroup {
  logic: 'and' | 'or';
  rules: (FilterRule | FilterGroup)[];
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less or Equal' },
  { value: 'in', label: 'In List' },
];

export function QueryBuilder({ 
  filters, 
  columns,
  onChange,
  onApply
}: { 
  readonly filters: FilterGroup; 
  readonly columns?: string[];
  readonly onChange: (f: FilterGroup) => void;
  readonly onApply: () => void;
}) {
  const columnOptions = useMemo(() => {
    return (columns || []).map(c => ({ value: c, label: c }));
  }, [columns]);
  const handleAddRule = () => {
    onChange({
      ...filters,
      rules: [...filters.rules, { field: '', operator: 'eq', value: '' }]
    });
  };

  const handleUpdateRule = (index: number, rule: Partial<FilterRule>) => {
    const newRules = [...filters.rules];
    newRules[index] = { ...(newRules[index] as FilterRule), ...rule };
    onChange({ ...filters, rules: newRules });
  };

  const handleRemoveRule = (index: number) => {
    const newRules = [...filters.rules];
    newRules.splice(index, 1);
    onChange({ ...filters, rules: newRules });
  };

  return (
    <div className="bg-muted/10 border border-border p-3 rounded-lg mb-4">
      <div className="space-y-2">
        {filters.rules.map((rule, i) => {
          const r = rule as FilterRule;
          return (
            <div key={i} className="flex items-center gap-2">
              {columns && columns.length > 0 ? (
                <div className="w-[250px]">
                  <Combobox 
                    options={columnOptions}
                    value={r.field}
                    onValueChange={(val) => handleUpdateRule(i, { field: val })}
                    placeholder="Select column..."
                    searchPlaceholder="Search columns..."
                  />
                </div>
              ) : (
                <input 
                  type="text" 
                  placeholder="Field (e.g. status, amount)"
                  className="text-sm bg-background border border-border rounded px-3 py-1.5 flex-1 max-w-[250px]"
                  value={r.field}
                  onChange={(e) => handleUpdateRule(i, { field: e.target.value })}
                />
              )}
              <select 
                className="text-sm bg-background border border-border rounded px-3 py-1.5 min-w-[120px]"
                value={r.operator}
                onChange={(e) => handleUpdateRule(i, { operator: e.target.value as FilterOperator })}
              >
                {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
              <input 
                type="text" 
                placeholder="Value..."
                className="text-sm bg-background border border-border rounded px-3 py-1.5 flex-1 max-w-[250px]"
                value={String(r.value ?? '')}
                onChange={(e) => handleUpdateRule(i, { value: e.target.value })}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveRule(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
        <div className="pt-1 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAddRule} className="text-xs h-8">
            <Plus className="w-3 h-3 mr-1" /> Add Condition
          </Button>
          <Button variant="default" size="sm" onClick={onApply} className="text-xs h-8">
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}
