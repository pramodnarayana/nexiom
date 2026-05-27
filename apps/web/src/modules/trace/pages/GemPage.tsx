import { Network } from 'lucide-react';

export function GemPage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Global Entity Map</h2>
          <p className="text-sm text-muted-foreground mt-1">
            View the mappings between Source Canonical and Destination Canonical entities.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-dashed border-border p-16 text-center bg-card/20">
        <Network className="mx-auto h-10 w-10 mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">GEM mapping table will be rendered here.</p>
      </div>
    </div>
  );
}
