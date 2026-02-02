import { Route, Routes } from 'react-router-dom';
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { AppRoutes } from '@/shared/lib/auth/constants';

import { dataProvider } from "../providers/data-provider";
import { authProvider } from "../providers/auth-provider";
import { accessControlProvider } from "../providers/access-control-provider";
import { notificationProvider } from "../providers/notification-provider";
import { AdminLayout } from '../layouts/AdminLayout';
import { AdminDashboardPage } from '../../modules/dashboard/pages/admin/AdminDashboardPage';
import { UserList } from '../../modules/identity/users/UserList';
import { UserShow } from '../../modules/identity/pages/admin/users/UserShow';
import { UserEdit } from '../../modules/identity/pages/admin/users/UserEdit';
import { TenantListPage } from '../../modules/tenants/pages/TenantListPage';
import { TenantEdit } from '../../modules/tenants/pages/TenantEdit';

export function AdminRoutes() {
    return (
        <Route path={`${AppRoutes.ADMIN.ROOT}/*`} element={
            <Refine
                authProvider={authProvider}
                dataProvider={dataProvider}
                routerProvider={routerProvider}
                accessControlProvider={accessControlProvider}
                resources={[
                    {
                        name: "admin/users",
                        list: "/admin/users",
                        edit: "/admin/users/edit/:id",
                        show: "/admin/users/show/:id",
                        meta: {
                            canDelete: true,
                        }
                    },
                    {
                        name: "admin/tenants",
                        list: "/admin/tenants",
                        edit: "/admin/tenants/:id",
                        show: "/admin/tenants/:id",
                        meta: {
                            label: "Tenants",
                        }
                    }
                ]}
                options={{
                    syncWithLocation: true,
                    warnWhenUnsavedChanges: true,
                }}
                notificationProvider={notificationProvider}
            >
                <Routes>
                    <Route element={<AdminLayout />}>
                        <Route index element={<AdminDashboardPage />} />
                        <Route path="users" element={<UserList basePath="/admin/users" resource="admin/users" />} />
                        <Route path="users/show/:id" element={<UserShow />} />
                        <Route path="users/edit/:id" element={<UserEdit />} />
                        <Route path="tenants" element={<TenantListPage />} />
                        <Route path="tenants/:id" element={<TenantEdit />} />
                        <Route path="settings" element={<div>Settings Placeholder</div>} />
                    </Route>
                </Routes>
            </Refine>
        } />
    );
}
