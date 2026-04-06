import { useEffect, useState } from 'react';
import { Network, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { listRelatedObjects, type RelatedObjectDescriptor } from '../api/metadata.api';
import type { StitchResponse } from '../api/stitches.api';

interface RelatedObjectsPanelProps {
  stitch: StitchResponse;
}

export function RelatedObjectsPanel({ stitch }: RelatedObjectsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedObjects, setRelatedObjects] = useState<RelatedObjectDescriptor[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listRelatedObjects(stitch.srcConnectionId, stitch.sourceObject);
        if (active) setRelatedObjects(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dependencies');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [stitch.srcConnectionId, stitch.sourceObject]);

  return (
    <Card className="border shadow-sm">
      <CardHeader className="py-4 border-b bg-muted/20">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          Related Data Objects
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Discovering business universe...
          </div>
        ) : error ? (
          <div className="p-6 m-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : relatedObjects.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground">
            No related objects dynamically discovered. This object will sync independently.
          </div>
        ) : (
          <div className="divide-y max-h-96 overflow-y-auto">
            {relatedObjects.map((mod, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{mod.objectName}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    Relation Path: {mod.relationField}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs bg-muted/20">
                    Auto-enrolled
                  </Badge>
                  <Badge variant="default" className="text-xs font-mono">
                    {mod.relationshipType}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
