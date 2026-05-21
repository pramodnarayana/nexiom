import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Combobox } from '@/shared/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { listAvailableConnections, type AvailableConnectionResponse } from '@/modules/workspaces/api/workspaces.api';
import { createStitch } from '../api/stitches.api';
import { listObjects, type ObjectDescriptor } from '../api/metadata.api';
import type { MappingRule } from '../api/field-mappings.api';
import { MappingCanvas, type SyncConditionRule } from '../components/MappingCanvas';
import { DependencyList } from '../components/DependencyList';
import { StitchConfigPanel } from '../components/StitchConfigPanel';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface WizardState {
  name: string;
  // Step 1
  srcDataSourceId: string;
  sourceObject: string;
  // Step 2
  destDataSourceId: string;
  targetObject: string;
  // Step 3
  mappingRules: MappingRule[];
  syncConditions: SyncConditionRule[];
  config: Record<string, unknown>;
}

const INITIAL_STATE: WizardState = {
  name: '',
  srcDataSourceId: '',
  sourceObject: '',
  destDataSourceId: '',
  targetObject: '',
  mappingRules: [],
  syncConditions: [],
  config: {},
};

// ── Step indicator ────────────────────────────────────────────────────────────

function stepClassName(isActive: boolean, isDone: boolean): string {
  if (isActive) return 'font-semibold text-primary';
  if (isDone) return 'text-muted-foreground line-through';
  return 'text-muted-foreground';
}

function StepIndicator({ current }: Readonly<{ current: Step }>) {
  const steps = ['Source', 'Destination', 'Mapping'] as const;
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((label, i) => {
        const step = (i + 1) as Step;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <span
              className={stepClassName(isActive, isDone)}
            >
              {step}. {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Object picker body ────────────────────────────────────────────────────────

interface ObjectPickerBodyProps {
  objects: ObjectDescriptor[];
  objectsLoading: boolean;
  objectsError: string | null;
  objectName: string;
  onObjectChange: (name: string) => void;
  onRefresh: () => void;
}

function ObjectPickerBody({
  objects,
  objectsLoading,
  objectsError,
  objectName,
  onObjectChange,
  onRefresh,
}: Readonly<ObjectPickerBodyProps>) {
  const options = useMemo(
    () => objects.map((o) => ({ value: o.name, label: o.label || o.name })),
    [objects],
  );

  if (objectsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading objects…
      </div>
    );
  }
  if (objectsError) {
    return <p className="text-sm text-destructive">{objectsError}</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <Combobox
        options={options}
        value={objectName}
        onValueChange={onObjectChange}
        placeholder="Select an object"
        searchPlaceholder="Search objects…"
        emptyMessage="No matching objects."
        className="flex-1"
      />
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh object list"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Refresh object list"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Connection + Object picker (shared by steps 1 and 2) ─────────────────────

interface ConnectionObjectPickerProps {
  label: string;
  connections: AvailableConnectionResponse[];
  dataSourceId: string;
  onConnectionChange: (id: string) => void;
  objects: ObjectDescriptor[];
  objectsLoading: boolean;
  objectsError: string | null;
  objectName: string;
  onObjectChange: (name: string) => void;
  onRefreshObjects: () => void;
}

function ConnectionObjectPicker({
  label,
  connections,
  dataSourceId,
  onConnectionChange,
  objects,
  objectsLoading,
  objectsError,
  objectName,
  onObjectChange,
  onRefreshObjects,
}: Readonly<ConnectionObjectPickerProps>) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{label} Connection</Label>
        <Select value={dataSourceId} onValueChange={onConnectionChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select a connection" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted rounded px-1 py-0.5 shrink-0">
                    {c.appName}
                  </span>
                  {c.displayName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {dataSourceId && (
        <div className="space-y-1.5">
          <Label>{label} Object</Label>
          <ObjectPickerBody
            objects={objects}
            objectsLoading={objectsLoading}
            objectsError={objectsError}
            objectName={objectName}
            onObjectChange={onObjectChange}
            onRefresh={onRefreshObjects}
          />
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CreateStitchPage() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const stitchesHref = `${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches`;

  const [step, setStep] = useState<Step>(1);
  const [wizard, setWizard] = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Connections — loaded once on mount
  const [connections, setConnections] = useState<AvailableConnectionResponse[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  // Objects — per connection, loaded lazily
  const [srcObjects, setSrcObjects] = useState<ObjectDescriptor[]>([]);
  const [srcObjectsLoading, setSrcObjectsLoading] = useState(false);
  const [srcObjectsError, setSrcObjectsError] = useState<string | null>(null);
  const [destObjects, setDestObjects] = useState<ObjectDescriptor[]>([]);
  const [destObjectsLoading, setDestObjectsLoading] = useState(false);
  const [destObjectsError, setDestObjectsError] = useState<string | null>(null);

  // Load-cancellation tokens — prevent stale responses from racing in-flight requests
  const srcLoadTokenRef = useRef(0);
  const destLoadTokenRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) return;
    listAvailableConnections(workspaceId)
      .then(setConnections)
      .catch((e: unknown) => {
        setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections.');
      })
      .finally(() => { setConnectionsLoading(false); });
  }, [workspaceId]);

  const loadSrcObjects = useCallback((dataSourceId: string, refresh = false) => {
    setSrcObjects([]);
    setSrcObjectsError(null);
    setSrcObjectsLoading(true);
    const token = ++srcLoadTokenRef.current;
    listObjects(dataSourceId, { refresh })
      .then((objects) => { if (token === srcLoadTokenRef.current) setSrcObjects(objects); })
      .catch((e: unknown) => {
        if (token === srcLoadTokenRef.current) {
          setSrcObjectsError(e instanceof Error ? e.message : 'Failed to load objects.');
        }
      })
      .finally(() => { if (token === srcLoadTokenRef.current) setSrcObjectsLoading(false); });
  }, []);

  const loadDestObjects = useCallback((dataSourceId: string, refresh = false) => {
    setDestObjects([]);
    setDestObjectsError(null);
    setDestObjectsLoading(true);
    const token = ++destLoadTokenRef.current;
    listObjects(dataSourceId, { refresh })
      .then((objects) => { if (token === destLoadTokenRef.current) setDestObjects(objects); })
      .catch((e: unknown) => {
        if (token === destLoadTokenRef.current) {
          setDestObjectsError(e instanceof Error ? e.message : 'Failed to load objects.');
        }
      })
      .finally(() => { if (token === destLoadTokenRef.current) setDestObjectsLoading(false); });
  }, []);

  function handleSrcConnectionChange(id: string) {
    setWizard((prev) => ({ ...prev, srcDataSourceId: id, sourceObject: '' }));
    loadSrcObjects(id);
  }

  function handleDestConnectionChange(id: string) {
    setWizard((prev) => ({ ...prev, destDataSourceId: id, targetObject: '' }));
    loadDestObjects(id);
  }

  const step1Valid = wizard.srcDataSourceId && wizard.sourceObject && wizard.name.trim().length > 0;
  const step2Valid = wizard.destDataSourceId && wizard.targetObject;

  async function handleCreate() {
    if (!workspaceId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createStitch({
        workspaceId,
        name: wizard.name.trim(),
        srcDataSourceId: wizard.srcDataSourceId,
        destDataSourceId: wizard.destDataSourceId,
        sourceObject: wizard.sourceObject,
        targetObject: wizard.targetObject,
        config: Object.keys(wizard.config).length > 0 ? wizard.config : undefined,
        ...(wizard.syncConditions.length > 0 && { syncCondition: wizard.syncConditions }),
        // Mappings are sent in the same request so the backend can persist them
        // atomically in a single transaction — no orphaned stitch on mapping failure.
        ...(wizard.mappingRules.length > 0 && {
          fieldMappings: [{ sourceCanonical: wizard.sourceObject, mappingRules: wizard.mappingRules }],
        }),
      });
      navigate(stitchesHref);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create stitch.');
    } finally {
      setSubmitting(false);
    }
  }

  const handleMappingChange = useCallback(
    (rules: MappingRule[], conditions: SyncConditionRule[]) => {
      setWizard((prev) => ({ ...prev, mappingRules: rules, syncConditions: conditions }));
    },
    [],
  );

  if (!workspaceId) {
    return <div className="p-6 text-sm text-destructive">Invalid workspace URL.</div>;
  }

  return (
    <div className={`p-6 mx-auto space-y-6 ${step === 3 ? 'max-w-5xl' : 'max-w-2xl'}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground p-1"
          onClick={() => { navigate(stitchesHref); }}
          aria-label="Back to stitches"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold">Create Stitch</h1>
      </div>

      <StepIndicator current={step} />

      {connectionsLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading connections…
        </div>
      )}

      {connectionsError && (
        <p className="text-sm text-destructive">{connectionsError}</p>
      )}

      {!connectionsLoading && !connectionsError && (
        <div className="border rounded-lg p-6 space-y-6">
          {/* ── Step 1 ────────────────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="stitch-name">Stitch Name</Label>
                <Input
                  id="stitch-name"
                  placeholder="e.g. SF Invoices → QuickBooks"
                  value={wizard.name}
                  onChange={(e) => { setWizard((prev) => ({ ...prev, name: e.target.value })); }}
                />
              </div>

              <ConnectionObjectPicker
                label="Source"
                connections={connections}
                dataSourceId={wizard.srcDataSourceId}
                onConnectionChange={handleSrcConnectionChange}
                objects={srcObjects}
                objectsLoading={srcObjectsLoading}
                objectsError={srcObjectsError}
                objectName={wizard.sourceObject}
                onObjectChange={(v) => { setWizard((prev) => ({ ...prev, sourceObject: v })); }}
                onRefreshObjects={() => { loadSrcObjects(wizard.srcDataSourceId, true); }}
              />

              {wizard.srcDataSourceId && wizard.sourceObject && (
                  <div className="pt-2">
                    <DependencyList 
                        dataSourceId={wizard.srcDataSourceId} 
                        objectName={wizard.sourceObject}
                        selected={(wizard.config.selectedRelatedObjects as string[]) || []}
                        onSelectionChange={(selected) => setWizard(prev => ({ ...prev, config: { ...prev.config, selectedRelatedObjects: selected } }))}
                    />
                  </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => { navigate(stitchesHref); }}>
                  Cancel
                </Button>
                <Button disabled={!step1Valid} onClick={() => { setStep(2); }}>
                  Next
                </Button>
              </div>
            </>
          )}

          {/* ── Step 2 ────────────────────────────────────────────────────── */}
          {step === 2 && (
            <>
              <ConnectionObjectPicker
                label="Destination"
                connections={connections}
                dataSourceId={wizard.destDataSourceId}
                onConnectionChange={handleDestConnectionChange}
                objects={destObjects}
                objectsLoading={destObjectsLoading}
                objectsError={destObjectsError}
                objectName={wizard.targetObject}
                onObjectChange={(v) => { setWizard((prev) => ({ ...prev, targetObject: v })); }}
                onRefreshObjects={() => { loadDestObjects(wizard.destDataSourceId, true); }}
              />

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => { setStep(1); }}>
                  Back
                </Button>
                <Button disabled={!step2Valid} onClick={() => { setStep(3); }}>
                  Next
                </Button>
              </div>
            </>
          )}

          {/* ── Step 3 ────────────────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <Tabs defaultValue="mapping" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="mapping">Field Mappings</TabsTrigger>
                  <TabsTrigger value="config">Advanced Configuration</TabsTrigger>
                </TabsList>
                <TabsContent value="mapping" className="outline-none">
                    <MappingCanvas
                        srcDataSourceId={wizard.srcDataSourceId}
                        sourceObject={wizard.sourceObject}
                        destDataSourceId={wizard.destDataSourceId}
                        targetObject={wizard.targetObject}
                        onChange={handleMappingChange}
                    />
                </TabsContent>
                <TabsContent value="config" className="outline-none">
                    <StitchConfigPanel
                        dataSourceId={wizard.srcDataSourceId}
                        value={wizard.config}
                        onChange={(config) => setWizard((prev) => ({ ...prev, config }))}
                    />
                </TabsContent>
              </Tabs>

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => { setStep(2); }}>
                  Back
                </Button>
                <Button disabled={submitting} onClick={() => { void handleCreate(); }}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Stitch
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
