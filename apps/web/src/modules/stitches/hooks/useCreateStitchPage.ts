import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { listWorkspaceConnections, type WorkspaceConnectionResponse } from '@/modules/workspaces/api/workspaces.api';
import { createStitch } from '../api/stitches.api';
import { listObjects, listCanonicalObjects, type ObjectDescriptor } from '../api/metadata.api';
import type { MappingRule } from '../api/field-mappings.api';
import type { SyncConditionRule } from '../components/MappingCanvas';

type Step = 1 | 2 | 3;

export interface WizardState {
  name: string;
  srcDataSourceId: string;
  sourceObjects: string[];
  destDataSourceId: string;
  targetObject: string;
  mappingRules: MappingRule[];
  syncConditions: SyncConditionRule[];
  config: Record<string, unknown>;
}

const INITIAL_STATE: WizardState = {
  name: '',
  srcDataSourceId: '',
  sourceObjects: [],
  destDataSourceId: '',
  targetObject: '',
  mappingRules: [],
  syncConditions: [],
  config: {},
};

export function useCreateStitchPage(workspaceId: string | undefined) {
  const navigate = useNavigate();
  const stitchesHref = `${AppRoutes.TENANT.WORKSPACES}/${workspaceId ?? ''}/stitches`;

  const [step, setStep] = useState<Step>(1);
  const [wizard, setWizard] = useState<WizardState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [connections, setConnections] = useState<WorkspaceConnectionResponse[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const [srcObjects, setSrcObjects] = useState<ObjectDescriptor[]>([]);
  const [srcObjectsLoading, setSrcObjectsLoading] = useState(false);
  const [srcObjectsError, setSrcObjectsError] = useState<string | null>(null);

  const [destObjects, setDestObjects] = useState<ObjectDescriptor[]>([]);
  const [destObjectsLoading, setDestObjectsLoading] = useState(false);
  const [destObjectsError, setDestObjectsError] = useState<string | null>(null);

  const srcLoadTokenRef = useRef(0);
  const destLoadTokenRef = useRef(0);

  useEffect(() => {
    if (!workspaceId) {
      setConnections([]);
      setConnectionsError(null);
      setConnectionsLoading(false);
      return;
    }
    let cancelled = false;
    setConnectionsLoading(true);
    listWorkspaceConnections(workspaceId)
      .then((data) => {
        if (!cancelled) setConnections(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections.');
        }
      })
      .finally(() => {
        if (!cancelled) setConnectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const loadSrcObjects = useCallback(() => {
    setSrcObjects([]);
    setSrcObjectsError(null);
    setSrcObjectsLoading(true);
    const token = ++srcLoadTokenRef.current;
    listCanonicalObjects()
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
    setWizard((prev) => ({ ...prev, srcDataSourceId: id, sourceObjects: [] }));
    loadSrcObjects();
  }

  function handleDestConnectionChange(id: string) {
    setWizard((prev) => ({ ...prev, destDataSourceId: id, targetObject: '' }));
    loadDestObjects(id);
  }

  const step1Valid = wizard.srcDataSourceId && wizard.sourceObjects.length > 0 && wizard.name.trim().length > 0;
  const step2Valid = wizard.destDataSourceId && wizard.targetObject;

  async function handleCreate() {
    if (!workspaceId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createStitch({
        workspaceId,
        name: wizard.name.trim(),
        sourceDataSourceId: wizard.srcDataSourceId,
        destDataSourceId: wizard.destDataSourceId,
        canonicalObject: wizard.sourceObjects[0],
        targetObject: wizard.targetObject,
        ...(wizard.syncConditions.length > 0 && { syncCondition: wizard.syncConditions }),
        ...(wizard.mappingRules.length > 0 && {
          fieldMappings: wizard.sourceObjects.map(obj => ({ sourceCanonical: obj, mappingRules: wizard.mappingRules })),
        }),
      });
      navigate(stitchesHref);
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create stitch.');
    } finally {
      setSubmitting(false);
    }
  }

  const handleMappingChange = useCallback((rules: MappingRule[], conditions: SyncConditionRule[]) => {
    setWizard((prev) => ({ ...prev, mappingRules: rules, syncConditions: conditions }));
  }, []);

  return {
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
  };
}
