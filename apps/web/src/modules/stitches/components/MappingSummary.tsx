import { ArrowRight, Boxes } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import type { StitchResponse } from '../api/stitches.api';

interface MappingSummaryProps {
  stitch: StitchResponse;
}

export function MappingSummary({ stitch }: MappingSummaryProps) {
  // Extract mappings from the stitch response
  const mappings = stitch.fieldMappings || [];

  return (
    <Card className="border shadow-sm">
      <CardHeader className="py-4 border-b bg-muted/20">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Boxes className="h-5 w-5 text-primary" />
          Field Mappings
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {mappings.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground">
            No field mappings configured for this stitch.
          </div>
        ) : (
          <div className="divide-y max-h-96 overflow-y-auto">
            {mappings.map((fm) => (
              fm.mappingRules.map((rule, idx) => {
                // Remove JSONPath indicators ($., data.) from display to keep it readable
                const cleanSrc = rule.src.replace(/^(\$\.|data\.)/, '');
                const cleanDest = rule.dest.replace(/^(\$\.|data\.)/, '');
                
                return (
                  <div key={`${fm.sourceCanonical}-${idx}`} className="flex items-center gap-4 p-4 hover:bg-muted/10 transition-colors">
                    <div className="flex-1 flex justify-end items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fm.sourceCanonical}</span>
                      <Badge variant="outline" className="font-mono bg-muted/20 whitespace-normal text-right">
                        {cleanSrc}
                      </Badge>
                    </div>

                    <div className="flex flex-col items-center justify-center flex-none w-16">
                      <ArrowRight className="h-4 w-4 text-muted-foreground mb-1" />
                      {rule.transform && (
                        <span className="text-[10px] uppercase font-bold text-primary tracking-wider">
                          {rule.transform}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 flex justify-start items-center gap-2">
                      <Badge variant="secondary" className="font-mono whitespace-normal text-left">
                        {cleanDest}
                      </Badge>
                    </div>
                  </div>
                );
              })
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
