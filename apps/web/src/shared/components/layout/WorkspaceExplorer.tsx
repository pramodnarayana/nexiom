import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
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
    const [expandedId, setExpandedId] = useState<string | null>(() =>
        workspaces.find((ws) => {
            const wsHref = `/dashboard/workspaces/${ws.id}`;
            return location.pathname === wsHref || location.pathname.startsWith(`${wsHref}/`);
        })?.id ?? null,
    );

    if (workspaces.length === 0) {
        return (
            <p className="px-2 text-xs text-muted-foreground italic">No workspaces yet.</p>
        );
    }

    return (
        <div className="space-y-0.5">
            {workspaces.map((ws) => {
                const isExpanded = expandedId === ws.id;
                const wsHref = `/dashboard/workspaces/${ws.id}`;
                const isActive = location.pathname === wsHref || location.pathname.startsWith(`${wsHref}/`);

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
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                className="shrink-0 p-0.5 rounded hover:bg-muted"
                                onClick={() => setExpandedId(isExpanded ? null : ws.id)}
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
                                <Link
                                    to={`${wsHref}/stitches`}
                                    className="block text-xs text-muted-foreground hover:text-foreground py-1 px-2 rounded hover:bg-muted/50"
                                >
                                    Stitches
                                </Link>
                                <Link
                                    to={wsHref}
                                    className="block text-xs text-muted-foreground hover:text-foreground py-1 px-2 rounded hover:bg-muted/50"
                                >
                                    Connections
                                </Link>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
