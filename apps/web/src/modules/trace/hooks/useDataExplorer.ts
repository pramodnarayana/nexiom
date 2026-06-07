import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listStitches, type StitchResponse } from '@/modules/stitches/api/stitches.api';

export const TABS = [
  { id: 'inbound',    label: 'Inbound',           description: 'Raw payloads received from source app (L1)' },
  { id: 'replica',    label: 'Replica',            description: 'Vendor objects stored in replica layer (L2)' },
  { id: 'normalized', label: 'Normalization',      description: 'Canonical entities in normalized form (L3)' },
  { id: 'entity-map', label: 'Entity Map',         description: 'Cross-system source to target ID linkages (L4)' },
  { id: 'outbound',   label: 'Outbound',           description: 'Payloads sent to the destination app (L5/L6)' },
] as const;

export type TabId = typeof TABS[number]['id'];

export function useDataExplorer() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<TabId>('inbound');
  const [selectedStitch, setSelectedStitch] = useState<StitchResponse | null>(null);
  const [stitches, setStitches] = useState<StitchResponse[]>([]);
  const [isLoadingStitches, setIsLoadingStitches] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      navigate('/dashboard', { replace: true });
      return;
    }

    let mounted = true;
    queueMicrotask(() => {
      if (mounted) setIsLoadingStitches(true);
    });
    listStitches(workspaceId)
      .then(data => {
        if (mounted) setStitches(data);
      })
      .catch(console.error)
      .finally(() => {
        if (mounted) setIsLoadingStitches(false);
      });

    return () => { mounted = false; };
  }, [workspaceId, navigate]);

  return {
    workspaceId,
    activeTab,
    setActiveTab,
    selectedStitch,
    setSelectedStitch,
    stitches,
    isLoadingStitches,
    activeTabMeta: TABS.find(t => t.id === activeTab)!,
  };
}
