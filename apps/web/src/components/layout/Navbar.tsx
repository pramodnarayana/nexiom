import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { Sidebar, type NavGroup } from './Sidebar';
import { type NavigateFunction, useLocation } from 'react-router-dom';

import { type AppUser } from './types';

interface NavbarProps {
    title?: string;
    navGroups: NavGroup[];
    user: AppUser | null;
    logout: () => void;
    navigate: NavigateFunction;
    headerContent?: React.ReactNode;
}

export function Navbar({ title, navGroups, user, logout, navigate, headerContent }: Readonly<NavbarProps>) {
    const location = useLocation();

    // Find current active item title for breadcrumb behavior
    const currentItem = navGroups.flatMap(g => g.items)
        .filter(i => location.pathname === i.href || location.pathname.startsWith(`${i.href}/`))
        .sort((a, b) => b.href.length - a.href.length)[0];

    return (
        <div className="h-16 border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-8 flex items-center justify-between sticky top-0 z-40">
            {/* Mobile Menu Trigger */}
            <div className="md:hidden">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="outline" size="icon" className="bg-background text-foreground border-border shadow-sm">
                            <Menu className="h-4 w-4" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 border-r-0 w-64">
                        <Sidebar
                            navGroups={navGroups}
                            user={user}
                            logout={logout}
                            navigate={navigate}
                            headerContent={headerContent}
                        />
                    </SheetContent>
                </Sheet>
            </div>

            {/* Breadcrumb / Title Area */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground ml-2 md:ml-0">
                {title && (
                    <>
                        <span className="font-semibold text-foreground hidden md:inline">{title}</span>
                        <span className="hidden md:inline">/</span>
                    </>
                )}
                <span className="text-foreground font-medium truncate max-w-[200px] md:max-w-none">
                    {currentItem?.label || 'Dashboard'}
                </span>
            </div>

            {/* Right Side Actions (If any specific actions needed here, can receive as children) */}
            <div className="flex items-center gap-4">
                {/* Add any header actions here if needed */}
            </div>
        </div>
    );
}
