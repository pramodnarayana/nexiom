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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const SidebarContent = ({ navGroups, location, user, navigate, logout }: {
    navGroups: { title: string, items: { label: string, href: string, icon: React.ElementType }[] }[],
    location: Location,
    user: { name?: string; email?: string; roles?: string[] } | null,
    navigate: NavigateFunction,
    logout: () => void
}) => (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-md border-r border-slate-200">
        {/* Header */}
        <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm shadow-blue-200">
                    N
                </div>
                <span className="text-xl font-bold text-slate-800 tracking-tight">Nexiom</span>
            </div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider ml-1">Admin Console</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
            {navGroups.map((group) => (
                <div key={group.title}>
                    <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                                            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border-l-4 border-blue-600 rounded-l-none'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                    >
                                        <item.icon className={`mr-3 h-4 w-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
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
        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="w-full justify-start px-2 py-6 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 transition-all group">
                        <div className="flex items-center gap-3 w-full">
                            <Avatar className="h-9 w-9 border border-slate-200">
                                <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${user?.name}`} />
                                <AvatarFallback className="bg-blue-100 text-blue-600 font-medium">
                                    {user?.name?.charAt(0) || 'A'}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 text-left overflow-hidden">
                                <p className="text-sm font-semibold text-slate-700 truncate group-hover:text-slate-900 transition-colors">
                                    {user?.name}
                                </p>
                                <p className="text-xs text-slate-500 truncate">
                                    {user?.email}
                                </p>
                            </div>
                            <Settings className="h-4 w-4 text-slate-400 group-hover:text-slate-600 ml-auto" />
                        </div>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                        Switch to User View
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>
                        Profile Settings
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={logout}>
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
        user: { name?: string; email?: string; roles?: string[] } | null,
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
        if (user && !user.roles?.includes('admin')) {
            console.warn("Access Denied: Admin Role Required. Current roles:", user.roles);
            navigate('/dashboard');
        }
    }, [isAuthenticated, user, navigate, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-slate-50">Loading Admin Panel...</div>;
    }

    if (!user || (!user.roles?.includes('admin'))) {
        return null; // Or unauthorized page
    }

    // Navigation Configuration
    const navGroups = [
        {
            title: "", // General
            items: [
                { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
                { label: 'Users', href: '/admin/users', icon: Users },
                { label: 'Organizations', href: '/admin/tenants', icon: Shield },
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
        <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
            {/* Desktop Sidebar */}
            <aside className="hidden md:block fixed inset-y-0 z-50 transition-all duration-300">
                <div className="h-full w-64 shadow-xl shadow-slate-200/50">
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
                        <Button variant="outline" size="icon" className="bg-white text-slate-800 border-slate-200 shadow-sm">
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
                <div className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-8 flex items-center justify-between sticky top-0 z-40">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="font-semibold text-slate-800">Admin</span>
                        <span>/</span>
                        <span className="text-slate-600 font-medium">
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
