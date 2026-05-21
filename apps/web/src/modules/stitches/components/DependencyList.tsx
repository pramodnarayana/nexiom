import { useEffect, useState, useMemo } from 'react';
import { Network, Loader2, AlertCircle, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Input } from '@/shared/components/ui/input';
import { listRelatedObjects, type RelatedObjectDescriptor } from '../api/metadata.api';

interface DependencyListProps {
  dataSourceId: string;
  objectName: string;
  selected?: string[];
  onSelectionChange?: (selected: string[]) => void;
}

export function DependencyList({ dataSourceId, objectName, selected = [], onSelectionChange }: DependencyListProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relatedObjects, setRelatedObjects] = useState<RelatedObjectDescriptor[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listRelatedObjects(dataSourceId, objectName);
        if (active) setRelatedObjects(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dependencies');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [dataSourceId, objectName]);

  const filteredObjects = useMemo(() => {
    // Exclude 1:N reverse child relationships to prevent UI confusion for users
    const parentRelationsOnly = relatedObjects.filter(o => o.relationshipType === '1:1');
    if (!searchQuery.trim()) return parentRelationsOnly;
    const lower = searchQuery.toLowerCase();
    return parentRelationsOnly.filter(o => o.objectName.toLowerCase().includes(lower));
  }, [relatedObjects, searchQuery]);

  const handleToggle = (uniqueIdent: string, fallbackName: string) => {
    if (!onSelectionChange) return;
    if (selected.includes(uniqueIdent) || selected.includes(fallbackName)) {
      onSelectionChange(selected.filter((n) => n !== uniqueIdent && n !== fallbackName));
    } else {
      onSelectionChange([...selected, uniqueIdent]);
    }
  };

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
    <Card className="border shadow-sm flex flex-col max-h-[400px]">
      <CardHeader className="py-3 px-4 bg-muted/30 border-b shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            Business Universe Dependencies
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {selected.length} selected
          </Badge>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            type="search" 
            placeholder="Search related objects..." 
            className="pl-9 h-9" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto min-h-0">
        <div className="divide-y relative">
          {filteredObjects.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No matching objects found.
            </div>
          ) : (
            filteredObjects.map((mod) => {
              const uniqueIdent = `${mod.objectName}::${mod.relationField}`;
              // Fallback to mod.objectName for backwards compatibility with older stored configs
              const isChecked = selected.includes(uniqueIdent) || selected.includes(mod.objectName);
              return (
                <div 
                    key={uniqueIdent} 
                    className="flex items-center gap-3 p-3 px-4 hover:bg-muted/10 transition-colors cursor-pointer"
                    onClick={() => handleToggle(uniqueIdent, mod.objectName)}
                >
                  <input 
                    type="checkbox" 
                    className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary cursor-pointer accent-primary" 
                    checked={isChecked}
                    onChange={() => handleToggle(uniqueIdent, mod.objectName)} 
                  />
                  <div className="flex flex-col gap-0.5 flex-1">
                    <span className="text-sm font-medium">
                      {mod.relationLabel || mod.objectLabel || mod.objectName}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {mod.relationField}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs font-mono bg-muted/20 shrink-0">
                    {mod.relationshipType}
                  </Badge>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
