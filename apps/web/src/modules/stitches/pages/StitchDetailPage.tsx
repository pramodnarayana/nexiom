import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/shared/components/ui/card';
import { useToast } from '@/shared/hooks/use-toast';

import { getStitch, updateStitch, type StitchResponse } from '../api/stitches.api';
import { SchedulePanel } from '../components/SchedulePanel';
import { RelatedObjectsPanel } from '../components/RelatedObjectsPanel';
import { StitchConfigPanel } from '../components/StitchConfigPanel';
import { MappingSummary } from '../components/MappingSummary';


export function StitchDetailPage() {
  const { id: workspaceId, stitchId: id } = useParams<{ id: string; stitchId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [stitch, setStitch] = useState<StitchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Configuration drafting state
  const [configDraft, setConfigDraft] = useState<Record<string, unknown> | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getStitch(id);
        if (active) {
          setStitch(data);
          setConfigDraft(data.config || {});
        }
      } catch (e: unknown) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load stitch.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [id]);

  const handleConfigSave = async () => {
    if (!stitch || !configDraft) return;
    setSavingConfig(true);
    try {
      const updated = await updateStitch(stitch.id, { config: configDraft });
      setStitch(updated);
      toast({ title: 'Configuration Saved', description: 'Advanced settings updated successfully.' });
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Could not save configuration.',
        variant: 'destructive',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Loading execution context...</p>
      </div>
    );
  }

  if (error || !stitch) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-4">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md border border-destructive/20 mb-4">
          {error || 'Stitch not found.'}
        </div>
        <Button variant="outline" onClick={() => navigate(`/dashboard/workspaces/${workspaceId}/stitches`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to list
        </Button>
      </div>
    );
  }

  // Determine if config changed
  const isConfigDirty = JSON.stringify(configDraft) !== JSON.stringify(stitch.config || {});

  return (
    <div className="container py-8 max-w-5xl space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/dashboard/workspaces/${workspaceId}/stitches`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{stitch.name}</h1>
              <Badge variant={stitch.status === 'ACTIVE' ? 'default' : 'secondary'}>{stitch.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Syncing {stitch.sourceObject} to {stitch.targetObject}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-8 space-y-8">
          <MappingSummary stitch={stitch} />
          
          <Card className="border shadow-sm">
            <CardHeader className="py-4 border-b bg-muted/20">
              <CardTitle className="text-lg font-semibold flex items-center justify-between">
                <span>Advanced Configuration</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {configDraft && (
                <StitchConfigPanel
                  connectionId={stitch.srcConnectionId}
                  value={configDraft}
                  onChange={setConfigDraft}
                />
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4 justify-end">
               <div className="flex items-center gap-3 w-full justify-between">
                 <span className="text-xs text-muted-foreground">Changes to configuration will take effect on the next execution.</span>
                 <Button onClick={handleConfigSave} disabled={!isConfigDirty || savingConfig}>
                   {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                   Save Changes
                 </Button>
               </div>
            </CardFooter>
          </Card>
        </div>

        <div className="md:col-span-4 space-y-8">
          <SchedulePanel stitch={stitch} onUpdated={setStitch} />
          <RelatedObjectsPanel stitch={stitch} />
        </div>
      </div>
    </div>
  );
}
