import { Route, Routes } from 'react-router-dom';
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { LayoutDashboard, Users, Settings } from 'lucide-react';

import { dataProvider } from "../providers/data-provider";
import { tenantAuthProvider } from "../providers/tenant-auth-provider";
import { TenantLayout } from '../layouts/TenantLayout';
import { DashboardPage } from '../../modules/dashboard/pages/DashboardPage';
import { UserList } from '../../modules/identity/users/UserList';

export function TenantRoutes() {
    const navGroups = [
        {
            title: "",
            items: [
                { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, exact: true },
                { label: 'Users', href: '/dashboard/users', icon: Users },
                { label: 'Settings', href: '/dashboard/settings', icon: Settings },
            ]
        }
    ];

    return (
        <Refine
            authProvider={tenantAuthProvider}
            dataProvider={dataProvider}
            routerProvider={routerProvider}
            resources={[
                {
                    name: "dashboard",
                    list: "/dashboard",
                },
                {
                    name: "users",
                    list: "/dashboard/users",
                    meta: {
                        label: "Users",
                    }
                }
            ]}
            options={{
                syncWithLocation: true,
                warnWhenUnsavedChanges: true,
            }}
        >
            <Routes>
                <Route element={<TenantLayout navGroups={navGroups} />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="users" element={<UserList basePath="/dashboard/users" resource="users" />} />
                    <Route path="settings" element={<div className="p-4">Settings coming soon</div>} />
                </Route>
            </Routes>
        </Refine>
    );
}
