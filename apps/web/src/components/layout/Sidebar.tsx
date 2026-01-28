import React from 'react';
import { Link, useLocation, type NavigateFunction } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Settings, LogOut } from 'lucide-react';

export interface NavGroup {
    title: string;
    items: {
        label: string;
        href: string;
        icon: React.ElementType;
    }[];
}

interface SidebarProps {
    navGroups: NavGroup[];
    user: { name?: string; email?: string; roles?: string[]; organizationName?: string } | null;
    logout: () => void;
    navigate: NavigateFunction;
    title?: string;
    showOrgSwitcher?: boolean;
    headerContent?: React.ReactNode;
}

export function Sidebar({
    navGroups,
    user,
    logout,
    navigate,
    headerContent
}: SidebarProps) {
    const location = useLocation();
    const isAdminView = location.pathname.startsWith('/admin');
    const isTenantView = location.pathname.startsWith('/dashboard');
    const hasAdminRole = user?.roles?.includes('admin') || user?.roles?.includes('owner') || user?.roles?.includes('platform_admin');

    return (
        <div className="flex flex-col h-full bg-card/50 backdrop-blur-md border-r border-border">
            {/* Header */}
            <div className="p-6">
                {headerContent}
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
                {navGroups.map((group) => (
                    <div key={group.title || 'general'}>
                        {group.title && (
                            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {group.title}
                            </h3>
                        )}
                        <div className="space-y-1">
                            {group.items.map((item) => {
                                const isActive = location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
                                return (
                                    <Link key={item.href} to={item.href}>
                                        <Button
                                            variant="ghost"
                                            className={cn(
                                                "w-full justify-start transition-all duration-200 font-medium",
                                                isActive
                                                    ? "bg-primary/10 text-primary border-l-4 border-primary rounded-l-none"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                            )}
                                        >
                                            <item.icon className={cn("mr-3 h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
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

                        {isAdminView && (
                            <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                                Switch to User View
                            </DropdownMenuItem>
                        )}

                        {isTenantView && hasAdminRole && (
                            <DropdownMenuItem onClick={() => navigate('/admin')}>
                                Switch to Admin View
                            </DropdownMenuItem>
                        )}

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
}
