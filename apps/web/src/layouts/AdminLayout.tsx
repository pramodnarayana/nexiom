import React, { useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import type { Location, NavigateFunction } from 'react-router-dom';
import { useAuth } from '../lib/auth/context';
import { Button } from '@/components/ui/button';
import {
    LayoutDashboard,
    Users,
    Settings,
    LogOut,
    Menu,
    Shield,
    Activity,
    CreditCard
} from 'lucide-react';
import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from '@/components/ui/sheet';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const SidebarContent = ({ navGroups, location, user, navigate, logout }: {
    navGroups: { title: string, items: { label: string, href: string, icon: React.ElementType }[] }[],
    location: Location,
    user: { name?: string; email?: string; roles?: string[] } | null,
    navigate: NavigateFunction,
    logout: () => void
}) => (
    <div className="flex flex-col h-full bg-background/80 backdrop-blur-md border-r border-border">
        {/* Header */}
        <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
                    N
                </div>
                <span className="text-xl font-bold text-foreground tracking-tight">Nexiom</span>
            </div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider ml-1">Admin Console</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
            {navGroups.map((group) => (
                <div key={group.title}>
                    <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                    </h3>
                    <div className="space-y-1">
                        {group.items.map((item) => {
                            const isActive = location.pathname === item.href;
                            return (
                                <Link key={item.href} to={item.href}>
                                    <Button
                                        variant="ghost"
                                        className={`w-full justify-start transition-all duration-200 font-medium ${isActive
                                            ? 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary border-l-4 border-primary rounded-l-none'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                            }`}
                                    >
                                        <item.icon className={`mr-3 h-4 w-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                                        {item.label}
                                    </Button>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ))}
        </nav>

        {/* Footer / User Profile */}
        <div className="p-4 border-t border-border mt-auto space-y-2">
            <div className="flex items-center justify-between px-2 gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">Theme</span>
                <ThemeSwitcher className="w-full min-w-[120px]" />
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="w-full justify-start h-auto px-2 py-3 hover:bg-accent hover:text-accent-foreground">
                        <div className="flex items-center gap-3 w-full">
                            <Avatar className="h-8 w-8 rounded-lg border border-border">
                                <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-bold">
                                    {user?.name?.charAt(0) || 'A'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 text-left overflow-hidden grid gap-0.5">
                                <p className="text-sm font-semibold text-foreground truncate">
                                    {user?.name}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                    {user?.email}
                                </p>
                            </div>
                            <Settings className="h-4 w-4 text-muted-foreground ml-auto opacity-50" />
                        </div>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" side="right" sideOffset={8}>
                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                        Switch to User View
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                        Profile Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="focus:text-destructive focus:bg-destructive/10" onClick={logout}>
                        <LogOut className="mr-2 h-4 w-4" />
                        Log out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    </div>
);

export function AdminLayout() {
    // We cast to correct type, assuming auth provider returns this shape
    const { user, isAuthenticated, logout, isLoading } = useAuth() as {
        user: { name?: string; email?: string; roles?: string[]; systemRole?: 'platform_admin' | 'user' } | null,
        isAuthenticated: boolean,
        logout: () => void,
        isLoading: boolean
    };

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (isLoading) return;
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }
        // Strict Platform Admin Check
        if (user && user.systemRole !== 'platform_admin') {
            console.warn("Access Denied: Platform Admin Required. Current role:", user.systemRole);
            navigate('/dashboard');
        }
    }, [isAuthenticated, user, navigate, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-background text-muted-foreground">Loading Admin Panel...</div>;
    }

    if (!user || user.systemRole !== 'platform_admin') {
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
                { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
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

    return (
        <div className="flex min-h-screen bg-muted/10 dark:bg-background font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block fixed inset-y-0 z-50 transition-all duration-300">
                <div className="h-full w-64 shadow-xl shadow-muted/20">
                    <SidebarContent
                        navGroups={navGroups}
                        location={location}
                        user={user}
                        navigate={navigate}
                        logout={logout}
                    />
                </div>
            </aside>

            {/* Mobile Sidebar */}
            <div className="md:hidden absolute top-4 left-4 z-50">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="icon" className="bg-background text-foreground border-border shadow-sm">
                            <Menu className="h-4 w-4" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 border-r-0 w-64">
                        <SidebarContent
                            navGroups={navGroups}
                            location={location}
                            user={user}
                            navigate={navigate}
                            logout={logout}
                        />
                    </SheetContent>
                </Sheet>
            </div>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 min-h-screen transition-all duration-300 ease-in-out">
                {/* Topbar (optional, can add breadcrumbs here) */}
                <div className="h-16 border-b border-border bg-background/80 backdrop-blur-sm px-8 flex items-center justify-between sticky top-0 z-40">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Admin</span>
                        <span>/</span>
                        <span className="text-muted-foreground font-medium">
                            {navGroups.flatMap(g => g.items).find(i => i.href === location.pathname)?.label || 'Dashboard'}
                        </span>
                    </div>
                </div>

                {/* Page Content */}
                <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
