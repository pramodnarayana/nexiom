import { Outlet, NavLink, useParams } from 'react-router-dom';
import { Activity, Database, Network } from 'lucide-react';

export function TraceLayout() {
  const { id: workspaceId } = useParams<{ id: string }>();

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Data Hub</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore data, verify mappings, and trace records end-to-end.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto pb-0">
        <NavLink
          to={`/dashboard/workspaces/${workspaceId}/data-hub/explorer`}
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-150 ${
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`
          }
        >
          <Database className="h-4 w-4" /> Data Explorer
        </NavLink>
        <NavLink
          to={`/dashboard/workspaces/${workspaceId}/data-hub/trace`}
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-150 ${
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`
          }
        >
          <Activity className="h-4 w-4" /> Trace
        </NavLink>
        <NavLink
          to={`/dashboard/workspaces/${workspaceId}/data-hub/gem`}
          className={({ isActive }) =>
            `flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all duration-150 ${
              isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`
          }
        >
          <Network className="h-4 w-4" /> Global Entity Map
        </NavLink>
      </div>

      <div className="mt-4">
        <Outlet />
      </div>
    </div>
  );
}
