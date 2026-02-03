import { Route, Routes } from 'react-router-dom';
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { LayoutDashboard, Users, Settings } from 'lucide-react';
import { AppRoutes } from '@/shared/lib/auth/constants';

import { dataProvider } from "../providers/data-provider";
import { tenantAuthProvider } from "../providers/tenant-auth-provider";
import { TenantLayout } from '../layouts/TenantLayout';
import { DashboardPage } from '../../modules/dashboard/pages/DashboardPage';
import { UserList } from '../../modules/identity/users/UserList';
import { UserShow } from '../../modules/identity/pages/admin/users/UserShow';
import { UserEdit } from '../../modules/identity/pages/admin/users/UserEdit';
import { TenantSettingsPage } from '../../modules/identity/pages/TenantSettingsPage';
import { UserProfilePage } from '../../modules/identity/pages/UserProfilePage';

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
        <Route path={`${AppRoutes.TENANT.ROOT}/*`} element={
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
                        show: "/dashboard/users/show/:id",
                        edit: "/dashboard/users/edit/:id",
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
                        <Route path="users/show/:id" element={<UserShow basePath="/dashboard/users" resource="users" />} />
                        <Route path="users/edit/:id" element={<UserEdit basePath="/dashboard/users" resource="users" />} />
                        <Route path="settings" element={<TenantSettingsPage />} />
                        <Route path="profile" element={<UserProfilePage />} />
                    </Route>
                </Routes>
            </Refine>
        } />
    );
}
