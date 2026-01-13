import React, { useEffect } from 'react';
import { Outlet, useNavigate, Link, useLocation } from 'react-router-dom';
import type { Location, NavigateFunction } from 'react-router-dom';
import { useAuth } from '../lib/auth/context';
import { Button } from '@/components/ui/button';
import {
    LogOut,
    Menu
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

const SidebarContent = ({ navGroups, location, user }: {
    navGroups: NavGroup[],
    location: Location,
    user: { name?: string; email?: string; roles?: string[]; organizationName?: string } | null,
    navigate: NavigateFunction,
    logout: () => void,
    title?: string
}) => (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-md border-r border-slate-200">
        {/* Header */}
        <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm shadow-indigo-200">
                    {user?.organizationName?.charAt(0).toUpperCase() || 'O'}
                </div>
                <span className="text-xl font-bold text-slate-800 tracking-tight truncate">
                    {user?.organizationName || "My Organization"}
                </span>
            </div>
            {/* Subtitle removed as requested */}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
            {navGroups.map((group) => (
                <div key={group.title}>
                    {group.title && (
                        <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            {group.title}
                        </h3>
                    )}
                    <div className="space-y-1">
                        {group.items.map((item) => {
                            const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
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
    </div>
);

export function TenantLayout({ title, navGroups }: DashboardLayoutProps) {
    const { user, isAuthenticated, logout, isLoading } = useAuth() as {
        user: { name?: string; email?: string; roles?: string[]; organizationName?: string } | null,
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
        }
        // Role check handled by Routes/AuthGuard usually, but we could add safe guard here
    }, [isAuthenticated, navigate, isLoading]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-slate-50">Loading...</div>;
    }

    if (!user) {
        return null;
    }

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
                        title={title}
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
                            title={title}
                        />
                    </SheetContent>
                </Sheet>
            </div>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 min-h-screen transition-all duration-300 ease-in-out">
                {/* Topbar (optional) */}
                <div className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-8 flex items-center justify-between sticky top-0 z-40">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        {title && (
                            <>
                                <span className="font-semibold text-slate-800">{title}</span>
                                <span>/</span>
                            </>
                        )}
                        <span className="text-slate-600 font-bold text-lg">
                            {navGroups.flatMap(g => g.items)
                                .filter(i => location.pathname === i.href || location.pathname.startsWith(i.href + '/'))
                                .sort((a, b) => b.href.length - a.href.length)[0]?.label || 'Dashboard'}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                                    <Avatar className="h-9 w-9 border border-slate-200 shadow-sm transition-shadow hover:shadow-md">
                                        <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${user?.name}`} />
                                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-medium">
                                            {user?.name?.charAt(0) || 'A'}
                                        </AvatarFallback>
                                    </Avatar>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56" align="end" forceMount>
                                <div className="flex items-center justify-start gap-2 p-2">
                                    <div className="flex flex-col space-y-1 leading-none">
                                        <p className="font-medium leading-none">{user?.name}</p>
                                        <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                                    </div>
                                </div>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {user?.roles?.includes('admin') && title !== 'Admin Console' && (
                                    <DropdownMenuItem onClick={() => navigate('/admin')}>
                                        Switch to Admin View
                                    </DropdownMenuItem>
                                )}
                                {user?.roles?.includes('admin') && title === 'Admin Console' && (
                                    <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                                        Switch to User View
                                    </DropdownMenuItem>
                                )}

                                <DropdownMenuItem disabled>
                                    Profile Settings
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={logout}>
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Sign out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
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
