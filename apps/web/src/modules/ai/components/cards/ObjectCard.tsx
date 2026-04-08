
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';

interface ObjectCardProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  isLoading?: boolean;
}

/**
 * A beautiful generic component aimed to parse and render complex entity
 * shapes dynamically returned by the `*getEntityWithRelations` tools.
 */
export function ObjectCard({ toolName, result, isLoading }: ObjectCardProps) {
  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl bg-card border-border animate-pulse group">
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/40">
          <div className="flex items-center gap-3">
             <div className="h-6 w-6 bg-primary/20 rounded-md" />
             <div className="h-5 bg-primary/20 rounded-md w-1/3" />
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
             <div className="h-4 bg-muted rounded-md w-full" />
             <div className="h-4 bg-muted rounded-md w-5/6" />
             <div className="h-4 bg-muted rounded-md w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  // Render error if present
  if (result.error) {
    return (
      <Card className="w-full max-w-2xl border-destructive/50 bg-destructive/10">
        <CardHeader>
          <CardTitle className="text-destructive text-sm font-medium">Failed to execute action</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive/80">{String(result.error)}</p>
        </CardContent>
      </Card>
    );
  }

  // Find the primary object dynamically
  let primaryType = '';
  let primaryObj: Record<string, unknown> | null = null;
  let relations: Record<string, unknown> = {};

  if (result.relations) {
      // It's a hydrator tool result
      for (const [k, v] of Object.entries(result)) {
        if (k !== 'connectionName' && k !== 'relations') {
           primaryType = k;
           primaryObj = v as Record<string, unknown>;
        }
      }
      relations = (result.relations as Record<string, unknown>) || {};
  } else {
      // Direct action tool return
      primaryObj = (result.data || result) as Record<string, unknown>;
      primaryType = toolName;
  }

  if (!primaryObj) return null;

  // Visual Heuristics: Only render high-value enterprise data points, not the raw DB dump
  const PRIORITY_KEYS = ['name', 'status', 'order', 'origin', 'destination', 'total', 'date', 'amount', 'from', 'to', 'number', 'weight'];
  const PRIORITY_RELATIONS = ['lineitem', 'invoice', 'stop', 'item'];

  const displayProps = Object.entries(primaryObj || {}).filter(([k, v]) => {
     if (k === '_note' || typeof v === 'object') return false;
     const lowerK = String(k).toLowerCase();
     return PRIORITY_KEYS.some(pk => lowerK.includes(pk));
  }).slice(0, 8); // Cap at 8 key data points

  const displayRelations = Object.entries(relations || {}).filter(([k]) => {
     const lowerK = String(k).toLowerCase();
     return PRIORITY_RELATIONS.some(pr => lowerK.includes(pr));
  });

  const safePrimaryType = String(primaryType || 'Entity');

  return (
    <Card className="w-full max-w-3xl overflow-hidden shadow-sm border-border">
      <CardHeader className="bg-muted/30 pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-foreground flex items-center gap-2">
              <span className="capitalize">{safePrimaryType.replace(/rtms__|__c/g, '').replace(/([A-Z])/g, ' $1').trim()}</span> Details
            </CardTitle>
            <Badge variant="outline" className="text-xs font-mono bg-background">
                {String(result.connectionName || 'Action')}
            </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pt-5 p-0">
          <div className="px-5 pb-5">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                {displayProps.map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
                      {String(key).replace(/rtms__|__c/g, '').replace(/([A-Z])/g, ' $1').trim()}
                    </dt>
                    <dd className="text-sm font-medium text-foreground">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
          </div>

          {displayRelations.length > 0 && (
             <div className="border-t border-border bg-muted/10 divide-y divide-border">
                {displayRelations.map(([relType, relData]: [string, unknown]) => {
                   const typedRelData = relData as Record<string, unknown>;
                   const records = Array.isArray(typedRelData?.records) ? typedRelData.records : [];
                   return (
                   <div key={relType} className="p-5">
                      <h4 className="text-sm font-semibold text-foreground mb-3 capitalize flex items-center justify-between">
                         {String(relType).replace(/rtms__|__c/g, '').replace(/([A-Z])/g, ' $1').trim()}
                         <Badge variant="secondary" className="text-[10px]">{records.length || 0}</Badge>
                      </h4>
                      {records.length > 0 ? (
                         <div className="space-y-3">
                            {records.map((rec: unknown, idx: number) => (
                               <div key={idx} className="bg-background rounded-md border border-border p-3 shadow-sm text-sm">
                                  <div className="grid grid-cols-2 gap-2">
                                     {Object.entries((rec as Record<string, unknown>) || {}).filter((entry) => {
                                        const v = entry[1];
                                        return typeof v !== 'object' && v !== null && v !== false;
                                     })
                                       .filter(([k]) => PRIORITY_KEYS.some(pk => String(k).toLowerCase().includes(pk)))
                                       .slice(0, 4)
                                       .map(([k, v]) => (
                                        <div key={k} className="flex flex-col">
                                           <span className="text-[10px] text-muted-foreground uppercase">{String(k).replace(/rtms__|__c/g, '').replace(/([A-Z])/g, ' $1').trim()}</span>
                                           <span className="truncate">{String(v)}</span>
                                        </div>
                                     ))}
                                  </div>
                               </div>
                            ))}
                         </div>
                      ) : (
                         <p className="text-xs text-muted-foreground italic">No related records found.</p>
                      )}
                   </div>
                   );
                })}
             </div>
          )}
      </CardContent>
    </Card>
  );
}
