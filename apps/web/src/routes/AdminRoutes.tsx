import { Route, Routes } from 'react-router-dom';
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";

import { dataProvider } from "../providers/data-provider";
import { authProvider } from "../providers/auth-provider";
import { AdminLayout } from '../layouts/AdminLayout';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { UserList } from '../modules/users/UserList';
import { UserShow } from '../pages/admin/users/UserShow';
import { UserEdit } from '../pages/admin/users/UserEdit';
import { TenantListPage } from '../pages/admin/tenants/TenantListPage';

export function AdminRoutes() {
    return (
        <Refine
            authProvider={authProvider}
            dataProvider={dataProvider}
            routerProvider={routerProvider}
            resources={[
                {
                    name: "users",
                    list: "/admin/users",
                    edit: "/admin/users/edit/:id",
                    show: "/admin/users/show/:id",
                    meta: {
                        canDelete: true,
                    }
                },
                {
                    name: "tenants",
                    list: "/admin/tenants",
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
        >
            <Routes>
                <Route element={<AdminLayout />}>
                    <Route index element={<AdminDashboardPage />} />
                    <Route path="users" element={<UserList basePath="/admin/users" />} />
                    <Route path="users/show/:id" element={<UserShow />} />
                    <Route path="users/edit/:id" element={<UserEdit />} />
                    <Route path="tenants" element={<TenantListPage />} />
                    <Route path="settings" element={<div>Settings Placeholder</div>} />
                </Route>
            </Routes>
        </Refine>
    );
}
