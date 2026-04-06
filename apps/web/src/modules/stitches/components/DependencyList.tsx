import { useEffect, useState } from 'react';
import { Network, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { listRelatedObjects, type RelatedObjectDescriptor } from '../api/metadata.api';

interface DependencyListProps {
  connectionId: string;
  objectName: string;
}

export function DependencyList({ connectionId, objectName }: DependencyListProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedObjects, setRelatedObjects] = useState<RelatedObjectDescriptor[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listRelatedObjects(connectionId, objectName);
        if (active) setRelatedObjects(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dependencies');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [connectionId, objectName]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground border rounded-md">
        <Loader2 className="h-4 w-4 animate-spin" />
        Discovering business universe...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (relatedObjects.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground border rounded-md bg-muted/30">
        No related objects discovered. This object will sync independently.
      </div>
    );
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="py-3 px-4 bg-muted/30 border-b">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          Business Universe Dependencies
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y max-h-64 overflow-y-auto">
          {relatedObjects.map((mod, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 px-4 hover:bg-muted/10 transition-colors">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{mod.objectName}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  via {mod.relationField}
                </span>
              </div>
              <Badge variant="outline" className="text-xs font-mono bg-muted/20">
                {mod.relationshipType}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
