import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/context';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';

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
    basePath?: string; // e.g. /admin or /dashboard
}

export function TenantLayout({ title, navGroups }: DashboardLayoutProps) {
    const { user, isAuthenticated, logout, isLoading } = useAuth() as {
        user: { name?: string; email?: string; roles?: string[]; organizationName?: string } | null,
        isAuthenticated: boolean,
        logout: () => void,
        isLoading: boolean
    };

    const navigate = useNavigate();

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            navigate('/login');
        }
    }, [isAuthenticated, navigate, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-background">Loading...</div>;
    }

    if (!user) {
        return null;
    }

    return (
        <div className="flex min-h-screen bg-background font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block fixed inset-y-0 z-50 transition-all duration-300">
                <div className="h-full w-64 shadow-xl shadow-muted/20">
                    <Sidebar
                        navGroups={navGroups}
                        user={user}
                        logout={logout}
                        navigate={navigate}
                        headerContent={
                            <div className="flex items-center gap-2 mb-1">
                                <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                                    {user?.organizationName?.charAt(0).toUpperCase() || 'O'}
                                </div>
                                <span className="text-xl font-bold text-foreground tracking-tight truncate">
                                    {user?.organizationName || "My Organization"}
                                </span>
                            </div>
                        }
                    />
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 min-h-screen transition-all duration-300 ease-in-out">
                <Navbar
                    title={title}
                    navGroups={navGroups}
                    user={user}
                    logout={logout}
                    navigate={navigate}
                    headerContent={
                        <div className="flex items-center gap-2 mb-1">
                            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                                {user?.organizationName?.charAt(0).toUpperCase() || 'O'}
                            </div>
                            <span className="text-xl font-bold text-foreground tracking-tight truncate">
                                {user?.organizationName || "My Organization"}
                            </span>
                        </div>
                    }
                />

                {/* Page Content */}
                <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
