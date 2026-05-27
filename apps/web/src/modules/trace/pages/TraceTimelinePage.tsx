import { useState } from 'react';
import { Search, Activity, ChevronLeft } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';

export function TraceTimelinePage() {
  const [globalSearch, setGlobalSearch] = useState('');
  const [isTracing, setIsTracing] = useState(false);

  const handleGlobalSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (globalSearch.trim()) {
      setIsTracing(true);
    }
  };

  if (isTracing) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4 border-b border-border pb-4">
          <Button variant="ghost" size="sm" onClick={() => setIsTracing(false)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back to Search
          </Button>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> End-to-End Trace: {globalSearch}
          </h2>
        </div>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Activity className="mx-auto h-12 w-12 text-primary/40 mb-4 animate-pulse" />
          <h2 className="text-lg font-medium">Pipeline Visualization</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            This view will render the complete horizontal timeline from L1 to L6 for trace ID or external record: <strong className="text-foreground">{globalSearch}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent rounded-2xl p-6 border border-primary/20 shadow-sm">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" /> Global Trace Search
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Instantly trace a record through the entire pipeline (L1-L6) by entering a Trace ID, External ID, or Invoice Number.
        </p>
        <form onSubmit={handleGlobalSearch} className="flex gap-3 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="e.g. INV-12345 or trc_8a9b..." 
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              className="w-full pl-9 h-10 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            />
          </div>
          <Button type="submit" disabled={!globalSearch.trim()}>Trace Complete Flow</Button>
        </form>
      </div>
    </div>
  );
}
