import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pause, Pencil, Play, Save, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/shared/components/ui/card';
import { useStitchDetailPage } from '../hooks/useStitchDetailPage';
import { SchedulePanel } from '../components/SchedulePanel';
import { DependencyList } from '../components/DependencyList';
import { StitchConfigPanel } from '../components/StitchConfigPanel';
import {
  MultiObjectMappingEditor,
} from '../components/MultiObjectMappingEditor';


export function StitchDetailPage() {
  const { id: workspaceId, stitchId: id } = useParams<{ id: string; stitchId: string }>();
  const navigate = useNavigate();

  const {
    stitch,
    setStitch,
    loading,
    error,
    editingName,
    nameDraft,
    setNameDraft,
    savingName,
    nameInputRef,
    cancellingRef,
    togglingStatus,
    configDraft,
    setConfigDraft,
    savingConfig,
    canonicalMappings,
    syncConditions,
    savingMappings,
    mappingsDirty,
    isConfigDirty,
    startEditingName,
    cancelEditingName,
    handleNameSave,
    handleStatusToggle,
    handleMappingChange,
    handleMappingSave,
    handleConfigSave,
  } = useStitchDetailPage(id);

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

  return (
    <div className="container py-8 max-w-5xl space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/dashboard/workspaces/${workspaceId}/stitches`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            {/* ── Inline name edit ── */}
            <div className="flex items-center gap-2">
              {editingName ? (
                <>
                  <input
                    ref={nameInputRef}
                    className="text-2xl font-semibold tracking-tight bg-transparent border-b-2 border-primary focus:outline-none w-64"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleNameSave();
                      if (e.key === 'Escape') cancelEditingName();
                    }}
                    onBlur={() => void handleNameSave()}
                    disabled={savingName}
                    autoFocus
                  />
                  {savingName
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : (
                      <>
                        <button type="button" onClick={() => void handleNameSave()} className="text-primary hover:text-primary/80" aria-label="Save name"><Check className="h-4 w-4" /></button>
                        <button
                          type="button"
                          onMouseDown={() => { cancellingRef.current = true; }}
                          onClick={cancelEditingName}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )
                  }
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">{stitch.name}</h1>
                  <button
                    type="button"
                    onClick={startEditingName}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Rename stitch"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </>
              )}
              <Badge variant={stitch.status === 'ACTIVE' ? 'default' : 'secondary'}>{stitch.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Syncing {stitch.sourceObject} → {stitch.targetObject}
            </p>
          </div>
        </div>
        {/* ── Status toggle ── */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleStatusToggle()}
          disabled={togglingStatus || stitch.status === 'ARCHIVED'}
          className="gap-2"
        >
          {togglingStatus
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : stitch.status === 'ACTIVE'
              ? <Pause className="h-4 w-4" />
              : <Play className="h-4 w-4" />
          }
          {stitch.status === 'ACTIVE' ? 'Pause' : 'Resume'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <div className="md:col-span-8 space-y-8">
          <Card className="border shadow-sm">
            <CardHeader className="py-4 border-b bg-muted/20">
              <CardTitle className="text-lg font-semibold flex items-center justify-between">
                <span>Field Mappings</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {stitch && canonicalMappings.length > 0 && (
                <MultiObjectMappingEditor
                  key={stitch.id}
                  srcDataSourceId={stitch.srcDataSourceId}
                  destDataSourceId={stitch.destDataSourceId}
                  primaryObject={stitch.sourceObject}
                  targetObject={stitch.targetObject}
                  initialMappings={canonicalMappings}
                  initialConditions={syncConditions}
                  onChange={handleMappingChange}
                />
              )}
            </CardContent>
            <CardFooter className="bg-muted/10 border-t py-4">
              <div className="flex items-center gap-3 w-full justify-between">
                <span className="text-xs text-muted-foreground">
                  Changes take effect on the next sync execution.
                </span>
                <Button onClick={() => void handleMappingSave()} disabled={!mappingsDirty || savingMappings}>
                  {savingMappings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Mappings
                </Button>
              </div>
            </CardFooter>
          </Card>
          
          <Card className="border shadow-sm">
            <CardHeader className="py-4 border-b bg-muted/20">
              <CardTitle className="text-lg font-semibold flex items-center justify-between">
                <span>Advanced Configuration</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {configDraft && (
                <StitchConfigPanel
                  dataSourceId={stitch.srcDataSourceId}
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
          <DependencyList 
            dataSourceId={stitch.srcDataSourceId}
            objectName={stitch.sourceObject}
            selected={(configDraft?.selectedRelatedObjects as string[]) || []}
            onSelectionChange={(selected) => setConfigDraft(prev => ({ ...(prev || {}), selectedRelatedObjects: selected }))}
          />
        </div>
      </div>
    </div>
  );
}