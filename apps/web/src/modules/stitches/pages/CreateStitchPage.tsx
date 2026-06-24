import { useMemo } from 'react';
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
import { MultiCombobox } from '@/shared/components/ui/multi-combobox';
import type { AvailableConnectionResponse } from '@/modules/workspaces/api/workspaces.api';
import type { ObjectDescriptor } from '../api/metadata.api';
import { useCreateStitchPage } from '../hooks/useCreateStitchPage';
import { MappingCanvas } from '../components/MappingCanvas';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

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
  objectName?: string;
  onObjectChange?: (name: string) => void;
  objectNames?: string[];
  onObjectNamesChange?: (names: string[]) => void;
  isMultiSelect?: boolean;
  onRefresh: () => void;
}

function ObjectPickerBody({
  objects,
  objectsLoading,
  objectsError,
  objectName,
  onObjectChange,
  objectNames,
  onObjectNamesChange,
  isMultiSelect,
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
      {isMultiSelect && objectNames && onObjectNamesChange ? (
        <MultiCombobox
          options={options}
          values={objectNames}
          onValuesChange={onObjectNamesChange}
          placeholder="Select objects"
          searchPlaceholder="Search objects…"
          emptyMessage="No matching objects."
          className="flex-1"
        />
      ) : (
        <Combobox
          options={options}
          value={objectName!}
          onValueChange={onObjectChange!}
          placeholder="Select an object"
          searchPlaceholder="Search objects…"
          emptyMessage="No matching objects."
          className="flex-1"
        />
      )}
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
  objectName?: string;
  onObjectChange?: (name: string) => void;
  objectNames?: string[];
  onObjectNamesChange?: (names: string[]) => void;
  isMultiSelect?: boolean;
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
  objectNames,
  onObjectNamesChange,
  isMultiSelect,
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
            objectNames={objectNames}
            onObjectNamesChange={onObjectNamesChange}
            isMultiSelect={isMultiSelect}
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

  const {
    step,
    setStep,
    wizard,
    setWizard,
    submitting,
    submitError,
    connections,
    connectionsLoading,
    connectionsError,
    srcObjects,
    srcObjectsLoading,
    srcObjectsError,
    destObjects,
    destObjectsLoading,
    destObjectsError,
    stitchesHref,
    handleSrcConnectionChange,
    handleDestConnectionChange,
    handleCreate,
    handleMappingChange,
    loadSrcObjects,
    loadDestObjects,
    step1Valid,
    step2Valid,
  } = useCreateStitchPage(workspaceId);

  if (!workspaceId) {
    return <div className="p-6 text-sm text-destructive">Invalid workspace URL.</div>;
  }

  return (
    <div className={`p-6 space-y-6 ${step === 3 ? 'w-full' : 'max-w-2xl mx-auto'}`}>
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
                objectNames={wizard.sourceObjects}
                onObjectNamesChange={(v) => { setWizard((prev) => ({ ...prev, sourceObjects: v })); }}
                isMultiSelect={true}
                onRefreshObjects={() => { loadSrcObjects(); }}
              />


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
              <div className="w-full">
                  <MappingCanvas
                      srcDataSourceId={wizard.srcDataSourceId}
                      sourceObject={wizard.sourceObjects[0]}
                      selectedRelatedObjects={wizard.sourceObjects.slice(1)}
                      destDataSourceId={wizard.destDataSourceId}
                      targetObject={wizard.targetObject}
                      onChange={handleMappingChange}
                  />
              </div>

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => { setStep(2); }}>
                  Back
                </Button>
                <Button disabled={submitting} onClick={() => { void handleCreate(); }}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Stitch
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
