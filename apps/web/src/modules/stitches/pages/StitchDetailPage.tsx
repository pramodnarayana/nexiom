import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pencil, Save, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/shared/components/ui/card';
import { useStitchDetailPage } from '../hooks/useStitchDetailPage';
import { MultiObjectMappingEditor } from '../components/MultiObjectMappingEditor';


export function StitchDetailPage() {
  const { id: workspaceId, stitchId: id } = useParams<{ id: string; stitchId: string }>();
  const navigate = useNavigate();

  const {
    stitch,
    loading,
    error,
    editingName,
    nameDraft,
    setNameDraft,
    savingName,
    nameInputRef,
    cancellingRef,
    canonicalMappings,
    syncConditions,
    savingMappings,
    mappingsDirty,
    startEditingName,
    cancelEditingName,
    handleNameSave,
    handleMappingChange,
    handleMappingSave,
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
    <div className="w-full px-6 py-8 space-y-8 animate-in fade-in duration-500">
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
              Syncing {[stitch.canonicalObject, ...(Array.isArray(stitch.config?.selectedRelatedObjects) ? (stitch.config.selectedRelatedObjects as string[]) : [])].join(', ')} → {stitch.targetObject}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
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
                  srcDataSourceId={stitch.sourceDataSourceId}
                  destDataSourceId={stitch.destDataSourceId}
                  primaryObject={stitch.canonicalObject}
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

      </div>
    </div>
  );
}