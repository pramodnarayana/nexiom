import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth/context';
import {
    LayoutDashboard,
    Users,
    Settings,
    Shield,
    Activity,
    CreditCard
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';

import { type AuthContextValue } from '@/components/layout/types';

export function AdminLayout() {
    // We cast to correct type, assuming auth provider returns this shape
    const { user, isAuthenticated, logout, isLoading } = useAuth() as AuthContextValue;

    const navigate = useNavigate();

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            navigate('/login');
        }
    }, [isAuthenticated, navigate, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">Loading Admin Panel...</div>;
    }

    if (!user) {
        return (
            <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">
                Access denied.
            </div>
        );
    }

    // Navigation Configuration
    const navGroups = [
        {
            title: "", // General
            items: [
                { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, exact: true },
                { label: 'Users', href: '/admin/users', icon: Users },
                { label: 'Tenants', href: '/admin/tenants', icon: Shield },
            ]
        },
        {
            title: "Configuration",
            items: [
                { label: 'Activity Logs', href: '/admin/logs', icon: Activity },
                { label: 'Billing', href: '/admin/billing', icon: CreditCard },
                { label: 'Settings', href: '/admin/settings', icon: Settings },
            ]
        }
    ];

    const headerContent = (
        <>
            <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                    N
                </div>
                <span className="text-xl font-bold text-foreground tracking-tight">Nexiom</span>
            </div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider ml-1">Admin Console</p>
        </>
    );

    return (
        <div className="flex min-h-screen bg-muted/10 dark:bg-background font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block fixed inset-y-0 z-50 transition-all duration-300">
                <div className="h-full w-64 shadow-xl shadow-muted/20">
                    <Sidebar
                        navGroups={navGroups}
                        user={user}
                        logout={logout}
                        navigate={navigate}
                        headerContent={headerContent}
                    />
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 min-h-screen transition-all duration-300 ease-in-out">
                <Navbar
                    title="Admin Console"
                    navGroups={navGroups}
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

