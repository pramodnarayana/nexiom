import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/shared/lib/auth/context';
import { Sidebar } from '@/shared/components/layout/Sidebar';
import { Navbar } from '@/shared/components/layout/Navbar';
import { useLocation } from 'react-router-dom';
import { useOrganization } from '@/modules/identity/hooks/useOrganization';
import { listWorkspaces } from '@/modules/workspaces/api/workspaces.api';
import type { WorkspaceItem } from '@/shared/components/layout/WorkspaceExplorer';

import { type AuthContextValue } from '@/shared/components/layout/types';

interface NavGroup {
    title: string;
    items: {
        label: string;
        href: string;
        icon: React.ElementType;
    }[];
}

interface DashboardLayoutProps {
    title?: string;
    navGroups: NavGroup[];
    bottomNavGroups?: NavGroup[];
    basePath?: string; // e.g. /admin or /dashboard
}

export function TenantLayout({ title, navGroups, bottomNavGroups }: Readonly<DashboardLayoutProps>) {
    const { user, isAuthenticated, logout, isLoading } = useAuth() as AuthContextValue;
    const navigate = useNavigate();

    // Move Hook to top-level (Unconditional)
    // We pass user?.organizationId safely. Hook handles undefined.
    const { data: org } = useOrganization(user?.organizationId);
    const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
    const location = useLocation();
    const prevPathRef = useRef(location.pathname);

    // Derived state
    const orgName = org?.name || user?.organizationName || "My Organization";

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            navigate('/login');
        }
    }, [isAuthenticated, navigate, isLoading]);

    useEffect(() => {
        if (!isAuthenticated || isLoading) return;
        listWorkspaces().then(setWorkspaces).catch(() => {
            console.warn('[TenantLayout] Failed to load workspaces for sidebar');
        });
    }, [isAuthenticated, isLoading]);

    // Re-fetch when navigating away from the workspaces management page so newly
    // created workspaces appear in the sidebar without a full page reload.
    useEffect(() => {
        const prev = prevPathRef.current;
        prevPathRef.current = location.pathname;
        if (!isAuthenticated || isLoading) return;
        if (prev.startsWith('/dashboard/workspaces') && !location.pathname.startsWith('/dashboard/workspaces')) {
            listWorkspaces().then(setWorkspaces).catch(() => {
                console.warn('[TenantLayout] Failed to refresh workspaces after navigation');
            });
        }
    }, [location.pathname, isAuthenticated, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-background">Loading...</div>;
    }

    if (!user) {
        return null;
    }

    const headerContent = (
        <div className="flex items-center gap-2 mb-1">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                {orgName.charAt(0).toUpperCase()}
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight truncate">
                {orgName}
            </span>
        </div>
    );

    return (
        <div className="flex min-h-screen bg-background font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block fixed inset-y-0 z-50 transition-all duration-300">
                <div className="h-full w-64 shadow-xl shadow-muted/20">
                    <Sidebar
                        navGroups={navGroups}
                        bottomNavGroups={bottomNavGroups}
                        user={user}
                        logout={logout}
                        navigate={navigate}
                        headerContent={headerContent}
                        workspaces={workspaces}
                    />
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 min-h-screen transition-all duration-300 ease-in-out">
                <Navbar
                    title={title}
                    navGroups={navGroups}
                    bottomNavGroups={bottomNavGroups}
                    workspaces={workspaces}
                    user={user}
                    logout={logout}
                    navigate={navigate}
                    headerContent={headerContent}
                />

                {/* Page Content */}
                <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
