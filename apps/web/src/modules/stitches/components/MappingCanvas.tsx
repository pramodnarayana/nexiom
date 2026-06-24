import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Loader2, Search, Code2, GripVertical } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/shared/components/ui/dialog';
import { Textarea } from '@/shared/components/ui/textarea';
import { Badge } from '@/shared/components/ui/badge';
import { listFields, listCanonicalFields, type FieldDescriptor } from '../api/metadata.api';
import type { MappingRule } from '../api/field-mappings.api';
export type SyncConditionOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
export type SyncConditionLogic = 'AND' | 'OR';

export interface SyncConditionRule {
  field: string;
  op: SyncConditionOp;
  /** Value is always a string from UI inputs; the backend coerces to number or boolean as needed. */
  value: string;
  logic: SyncConditionLogic;
}

export interface MappingCanvasProps {
  srcDataSourceId: string;
  sourceObject: string;
  selectedRelatedObjects?: string[];
  destDataSourceId: string;
  targetObject: string;
  initialRules?: MappingRule[];
  onChange: (rules: MappingRule[], conditions: SyncConditionRule[]) => void;
}

interface SourceSchema {
  objectName: string;
  fields: FieldDescriptor[];
}

interface CanvasState {
  sourceSchemas: SourceSchema[];
  destFields: FieldDescriptor[];
  loading: boolean;
  error: string | null;
  mappings: Record<string, string>; // destPath -> JSONata expression
  searchDest: string;
  searchSrc: string;
}

type Action = 
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; sourceSchemas: SourceSchema[]; destFields: FieldDescriptor[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_MAPPING'; destPath: string; expression: string }
  | { type: 'SET_SEARCH_DEST'; query: string }
  | { type: 'SET_SEARCH_SRC'; query: string };

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, sourceSchemas: action.sourceSchemas, destFields: action.destFields };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_MAPPING': {
      const newMappings = { ...state.mappings };
      if (!action.expression) {
        delete newMappings[action.destPath];
      } else {
        newMappings[action.destPath] = action.expression;
      }
      return { ...state, mappings: newMappings };
    }
    case 'SET_SEARCH_DEST':
      return { ...state, searchDest: action.query };
    case 'SET_SEARCH_SRC':
      return { ...state, searchSrc: action.query };
    default:
      return state;
  }
}

const EMPTY_ARRAY: string[] = [];

export function MappingCanvas({
  srcDataSourceId,
  sourceObject,
  selectedRelatedObjects = EMPTY_ARRAY,
  destDataSourceId,
  targetObject,
  initialRules,
  onChange
}: Readonly<MappingCanvasProps>) {
  
  const initialState = useMemo<CanvasState>(() => {
    const mappings: Record<string, string> = {};
    if (initialRules) {
      initialRules.forEach(r => {
        // In Enterprise UI, the expression IS the mapping. 
        // We simulate Hub translation by preferring expression if it exists, else srcPath
        mappings[r.dest] = r.transform || r.src || '';
      });
    }
    return {
      sourceSchemas: [],
      destFields: [],
      loading: true,
      error: null,
      mappings,
      searchDest: '',
      searchSrc: ''
    };
  }, [initialRules]);

  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'FETCH_START' });

    const fetchAll = async () => {
      try {
        const objectsToFetch = [sourceObject, ...selectedRelatedObjects];
        
        const [destRes, ...srcResArray] = await Promise.all([
          listFields(destDataSourceId, targetObject),
          ...objectsToFetch.map(obj => listCanonicalFields(obj).then(fields => ({ objectName: obj, fields })))
        ]);

        const SYSTEM_FIELDS_BLOCKLIST = new Set([
          'id', 'hubid', 'hub_id', 'createdat', 'created_at', 'createddate',
          'updatedat', 'updated_at', 'lastmodifieddate',
          'systemmodstamp', 'isdeleted',
          'metadata.createtime', 'metadata.lastupdatedtime',
          'synctoken', 'domain', 'sparse', 'active'
        ]);

        if (!cancelled) {
          const filteredDestRes = destRes.filter(
            f => !SYSTEM_FIELDS_BLOCKLIST.has(f.name.toLowerCase())
          );
          
          const filteredSrcResArray = srcResArray.map(schema => ({
            ...schema,
            fields: schema.fields.filter(f => !SYSTEM_FIELDS_BLOCKLIST.has(f.name.toLowerCase()))
          }));

          dispatch({ type: 'FETCH_SUCCESS', destFields: filteredDestRes, sourceSchemas: filteredSrcResArray });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({ type: 'FETCH_ERROR', error: err instanceof Error ? err.message : 'Failed to fetch schema' });
        }
      }
    };

    void fetchAll();
    return () => { cancelled = true; };
  }, [srcDataSourceId, sourceObject, selectedRelatedObjects, destDataSourceId, targetObject]);

  // Notify Parent on changes
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    // Convert mapping state back to MappingRule array
    const rules: MappingRule[] = Object.entries(state.mappings)
      .filter(([, expr]) => expr.trim() !== '')
      .map(([dest, expr]) => {
         // If it looks like a simple path, use src=expr, else src='formula', transform=expr
         const isSimplePath = /^[a-zA-Z0-9_.]+$/.test(expr);
         if (isSimplePath) {
           return { src: expr, dest };
         }
         return { src: 'formula', dest, transform: expr };
      });
      
    // Hub translation logic is simulated here. In a real app, backend translates it.
    // For conditions, we pass empty array as we removed them from this UI for simplicity
    onChangeRef.current(rules, []);
  }, [state.mappings]);

  // Formula Builder Modal State
  const [formulaField, setFormulaField] = useState<FieldDescriptor | null>(null);
  const [formulaValue, setFormulaValue] = useState('');

  const openFormulaBuilder = (field: FieldDescriptor) => {
    setFormulaField(field);
    setFormulaValue(state.mappings[field.name] || '');
  };

  const saveFormula = () => {
    if (formulaField) {
      dispatch({ type: 'SET_MAPPING', destPath: formulaField.name, expression: formulaValue });
      setFormulaField(null);
    }
  };

  const handleFieldClick = (objName: string, fieldName: string) => {
    // If formula builder is open, insert it into the formula
    const fullPath = `${objName}.${fieldName}`;
    if (formulaField) {
      setFormulaValue(prev => prev + (prev.endsWith(' ') || prev === '' ? fullPath : ` ${fullPath}`));
    }
  };

  // Drag and Drop (Simulation - just populates the input for now)
  const onDragStart = (e: React.DragEvent, objName: string, fieldName: string) => {
    e.dataTransfer.setData('text/plain', `${objName}.${fieldName}`);
  };

  const filteredDestFields = state.destFields.filter(f => f.name.toLowerCase().includes(state.searchDest.toLowerCase()) || (f.label && f.label.toLowerCase().includes(state.searchDest.toLowerCase())));

  if (state.loading) return <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
  if (state.error) return <div className="p-4 bg-destructive/10 text-destructive rounded-md">{state.error}</div>;

  return (
    <div className="grid grid-cols-2 gap-6 h-[900px] bg-background">
      {/* ── Left Pane: Source Schema ── */}
      <div className="flex flex-col border rounded-xl overflow-hidden shadow-sm bg-card">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold text-sm mb-3">Source Schema</h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search source fields..." 
              className="pl-8 bg-background h-9"
              value={state.searchSrc}
              onChange={e => dispatch({ type: 'SET_SEARCH_SRC', query: e.target.value })}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {state.sourceSchemas.map(schema => {
            const filteredFields = schema.fields.filter(f => f.name.toLowerCase().includes(state.searchSrc.toLowerCase()));
            if (filteredFields.length === 0) return null;
            
            return (
              <div key={schema.objectName} className="space-y-1">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-card/95 backdrop-blur z-10">
                  {schema.objectName}
                  {schema.objectName !== sourceObject && <Badge variant="secondary" className="ml-2 text-[10px]">Related</Badge>}
                </div>
                {filteredFields.map(f => (
                  <div 
                    key={f.name} 
                    draggable
                    onDragStart={(e) => onDragStart(e, schema.objectName, f.name)}
                    onClick={() => handleFieldClick(schema.objectName, f.name)}
                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent cursor-pointer group transition-colors"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground cursor-grab" />
                    <div>
                      <div className="font-medium text-foreground">{f.label || f.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{f.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right Pane: Destination Schema ── */}
      <div className="flex flex-col border rounded-xl overflow-hidden shadow-sm bg-card relative">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
            <span>Destination: {targetObject}</span>
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 shadow-[0_0_10px_rgba(var(--primary),0.1)]">
              Auto-Translating to Hub
            </Badge>
          </h3>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search destination fields..." 
              className="pl-8 bg-background h-9"
              value={state.searchDest}
              onChange={e => dispatch({ type: 'SET_SEARCH_DEST', query: e.target.value })}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {filteredDestFields.map(f => {
            const hasMapping = !!state.mappings[f.name];
            return (
              <div key={f.name} className={`space-y-1.5 p-3 rounded-lg border transition-all ${hasMapping ? 'bg-primary/5 border-primary/20' : 'bg-background hover:border-muted-foreground/30'}`}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    {f.label || f.name}
                    {!f.nillable && <span className="text-destructive">*</span>}
                  </label>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => openFormulaBuilder(f)}>
                    <Code2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Input 
                    placeholder="Drop source field here or click </>"
                    value={state.mappings[f.name] || ''}
                    onChange={(e) => dispatch({ type: 'SET_MAPPING', destPath: f.name, expression: e.target.value })}
                    className={`font-mono text-xs ${hasMapping ? 'border-primary/30 focus-visible:ring-primary/30' : ''}`}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedData = e.dataTransfer.getData('text/plain');
                      if (droppedData) {
                        dispatch({ type: 'SET_MAPPING', destPath: f.name, expression: droppedData });
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Formula Builder Modal ── */}
      <Dialog open={!!formulaField} onOpenChange={(open) => !open && setFormulaField(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-primary" />
              Formula Builder: {formulaField?.name}
            </DialogTitle>
            <DialogDescription>
              Write a JSONata expression. Click source fields on the left to insert them into your formula.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-3 gap-4 py-4">
            <div className="col-span-1 border rounded-md overflow-y-auto max-h-[300px] p-2 bg-muted/10">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Insert Field</div>
              {state.sourceSchemas.map(schema => (
                <div key={schema.objectName} className="mb-4">
                  <div className="text-[10px] text-muted-foreground font-mono bg-muted px-2 py-1 sticky top-0">{schema.objectName}</div>
                  {schema.fields.map(f => (
                    <div 
                      key={f.name}
                      onClick={() => handleFieldClick(schema.objectName, f.name)}
                      className="text-xs font-mono px-2 py-1.5 hover:bg-primary/10 hover:text-primary cursor-pointer rounded mt-0.5 truncate"
                      title={f.name}
                    >
                      {f.name}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="col-span-2 flex flex-col gap-2">
              <div className="bg-muted text-muted-foreground p-3 rounded-md text-xs font-mono">
                <span className="text-primary font-bold mr-2">Example:</span> 
                $trim(TMS_CARRIER.name & ' - ' & TMS_TP.mc_number)
              </div>
              <Textarea 
                value={formulaValue}
                onChange={(e) => setFormulaValue(e.target.value)}
                className="flex-1 font-mono text-sm resize-none"
                placeholder="Enter JSONata expression..."
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormulaField(null)}>Cancel</Button>
            <Button onClick={saveFormula}>Apply Formula</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
