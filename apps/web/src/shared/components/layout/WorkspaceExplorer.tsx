import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { AppRoutes } from '@/shared/lib/auth/constants';
import type { EnvType } from '@/modules/workspaces/api/workspaces.api';

export interface WorkspaceItem {
    id: string;
    name: string;
    envType: EnvType;
}

interface WorkspaceExplorerProps {
    workspaces: WorkspaceItem[];
}

function envAccent(envType: EnvType) {
    return envType === 'SANDBOX'
        ? 'text-amber-600 border-amber-400'
        : 'text-green-700 border-green-500';
}

function envDot(envType: EnvType) {
    return envType === 'SANDBOX' ? 'bg-amber-400' : 'bg-green-500';
}

export function WorkspaceExplorer({ workspaces }: Readonly<WorkspaceExplorerProps>) {
    const location = useLocation();

    // Tracks the last explicit chevron toggle.  null = no override yet.
    // When set, this takes precedence over the route-derived expansion so
    // the user's intent (collapse/expand) is respected even after navigation.
    const [manualState, setManualState] = useState<{ id: string; collapsed: boolean } | null>(null);

    if (workspaces.length === 0) {
        return (
            <p className="px-2 text-xs text-muted-foreground italic">No workspaces yet.</p>
        );
    }

    // Discard manualState if the workspace it referenced has been deleted.
    // Computed inline — no useEffect or setState required.
    const isManualStateValid =
        manualState !== null && workspaces.some((ws) => ws.id === manualState.id);
    const effectiveManualState = isManualStateValid ? manualState : null;

    // The workspace whose route currently matches the URL (if any).
    // Computed inline on every render — no effect or sync needed.
    const routeMatchedId = workspaces.find((ws) => {
        const wsHref = `${AppRoutes.TENANT.WORKSPACES}/${ws.id}`;
        return location.pathname === wsHref || location.pathname.startsWith(`${wsHref}/`);
    })?.id ?? null;

    return (
        <div className="space-y-0.5">
            {workspaces.map((ws) => {
                const wsHref = `${AppRoutes.TENANT.WORKSPACES}/${ws.id}`;
                const isActive = ws.id === routeMatchedId;

                // Expansion priority (no useEffect required):
                // 1. User explicitly toggled this workspace → honour that choice.
                // 2. No manual override (or stale override) → auto-expand when route matches.
                const isExpanded =
                    effectiveManualState?.id === ws.id
                        ? !effectiveManualState.collapsed
                        : ws.id === routeMatchedId;

                return (
                    <div key={ws.id}>
                        {/* Folder node row */}
                        <div
                            className={cn(
                                'flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer select-none group',
                                isActive
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                            )}
                        >
                            {/* Expand / collapse chevron */}
                            <button
                                type="button"
                                aria-label={isExpanded ? `Collapse ${ws.name}` : `Expand ${ws.name}`}
                                aria-expanded={isExpanded}
                                className="shrink-0 p-0.5 rounded hover:bg-muted"
                                onClick={() => setManualState({ id: ws.id, collapsed: isExpanded })}
                            >
                                <ChevronRight
                                    className={cn(
                                        'h-3.5 w-3.5 transition-transform duration-150',
                                        isExpanded && 'rotate-90',
                                    )}
                                />
                            </button>

                            {/* Folder icon with env accent */}
                            {isExpanded
                                ? <FolderOpen className={cn('h-4 w-4 shrink-0', envAccent(ws.envType))} />
                                : <Folder className={cn('h-4 w-4 shrink-0', envAccent(ws.envType))} />
                            }

                            {/* Workspace name — clicking navigates to detail page */}
                            <Link
                                to={wsHref}
                                className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-medium truncate"
                            >
                                <span className="truncate">{ws.name}</span>
                                {/* Env dot */}
                                <span className={cn('shrink-0 h-1.5 w-1.5 rounded-full', envDot(ws.envType))} />
                            </Link>
                        </div>

                        {isExpanded && (
                            <div className="ml-6 mt-0.5 border-l border-border pl-3 space-y-0.5 pb-1">
                                {(() => {
                                    const stitchesHref = `${wsHref}/stitches`;
                                    const isStitchesActive = location.pathname === stitchesHref || location.pathname.startsWith(`${stitchesHref}/`);
                                    const dataHubHref = `${wsHref}/data-hub`;
                                    const isDataHubActive = location.pathname === dataHubHref || location.pathname.startsWith(`${dataHubHref}/`);
                                    return (
                                        <>
                                            <Link
                                                to={stitchesHref}
                                                aria-current={isStitchesActive ? 'page' : undefined}
                                                className={cn(
                                                    'block text-xs py-1 px-2 rounded',
                                                    isStitchesActive
                                                        ? 'text-primary bg-primary/10 font-medium'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                                                )}
                                            >
                                                Stitches
                                            </Link>
                                            <Link
                                                to={dataHubHref}
                                                aria-current={isDataHubActive ? 'page' : undefined}
                                                className={cn(
                                                    'block text-xs py-1 px-2 rounded',
                                                    isDataHubActive
                                                        ? 'text-primary bg-primary/10 font-medium'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                                                )}
                                            >
                                                Data Hub
                                            </Link>
                                        </>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}