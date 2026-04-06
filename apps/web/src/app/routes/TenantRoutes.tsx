import { Route, Routes } from 'react-router-dom';
import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { LayoutDashboard, Users, Settings, Blocks, Plug2 } from 'lucide-react';
import { AppRoutes } from '@/shared/lib/auth/constants';
import { RESOURCES } from '@/shared/constants/resources';

import { dataProvider } from "../providers/data-provider";
import { tenantAuthProvider } from "../providers/tenant-auth-provider";
import { accessControlProvider } from "../providers/access-control-provider";
import { TenantLayout } from '../layouts/TenantLayout';
import { DashboardPage } from '../../modules/dashboard/pages/DashboardPage';
import { UserList } from '../../modules/identity/users/UserList';
import { UserShow } from '../../modules/identity/pages/admin/users/UserShow';
import { UserEdit } from '../../modules/identity/pages/admin/users/UserEdit';
import { TenantSettingsPage } from '../../modules/identity/pages/TenantSettingsPage';
import { UserProfilePage } from '../../modules/identity/pages/UserProfilePage';
import { AppScopeProvider } from '@/shared/contexts/AppScopeContext';
import { ConnectionsPage as MarketplacePage } from '../../modules/connections/pages/ConnectionsPage';
import { ActiveConnectionsPage } from '../../modules/connections/pages/ActiveConnectionsPage';
import { WorkspacesPage } from '../../modules/workspaces/pages/WorkspacesPage';
import { WorkspaceDetailPage } from '../../modules/workspaces/pages/WorkspaceDetailPage';
import { StitchesPage } from '../../modules/stitches/pages/StitchesPage';
import { CreateStitchPage } from '../../modules/stitches/pages/CreateStitchPage';
import { StitchDetailPage } from '../../modules/stitches/pages/StitchDetailPage';
import { ExceptionCenterPage } from '../../modules/exceptions/pages/ExceptionCenterPage';
import { PipelineTracePage } from '../../modules/trace/pages/PipelineTracePage';
import { AlertTriangle } from 'lucide-react';

export function TenantRoutes() {
    const navGroups = [
        {
            title: "",
            items: [
                { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, exact: true },
                { label: 'Exceptions', href: '/dashboard/exceptions', icon: AlertTriangle },
                { label: 'Users', href: '/dashboard/users', icon: Users },
                { label: 'Marketplace', href: '/dashboard/marketplace', icon: Blocks },
                { label: 'Active Connections', href: '/dashboard/active-connections', icon: Plug2 },
            ]
        }
    ];

    const bottomNavGroups = [
        {
            title: "",
            items: [
                { label: 'Settings', href: '/dashboard/settings', icon: Settings },
            ]
        }
    ];

    return (
        <Route path={`${AppRoutes.TENANT.ROOT}/*`} element={
            <AppScopeProvider scope="organization">
                <Refine
                    authProvider={tenantAuthProvider}
                    dataProvider={dataProvider}
                    routerProvider={routerProvider}
                    accessControlProvider={accessControlProvider}
                    resources={[
                        {
                            // Dashboard is intentionally not part of RESOURCES.ORGANIZATION
                            // It's a special tenant-level route, not a managed resource
                            name: "dashboard",
                            list: "/dashboard",
                        },
                        {
                            name: RESOURCES.ORGANIZATION.USERS,
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
                        <Route element={<TenantLayout navGroups={navGroups} bottomNavGroups={bottomNavGroups} />}>
                            <Route index element={<DashboardPage />} />
                            <Route path="users" element={<UserList />} />
                            <Route path="users/show/:id" element={<UserShow />} />
                            <Route path="users/edit/:id" element={<UserEdit />} />
                            <Route path="settings" element={<TenantSettingsPage />} />
                            <Route path="profile" element={<UserProfilePage />} />
                            <Route path="marketplace" element={<MarketplacePage />} />
                            <Route path="active-connections" element={<ActiveConnectionsPage />} />
                            <Route path="workspaces" element={<WorkspacesPage />} />
                            <Route path="workspaces/:id" element={<WorkspaceDetailPage />} />
                            <Route path="workspaces/:id/stitches" element={<StitchesPage />} />
                            <Route path="workspaces/:id/stitches/new" element={<CreateStitchPage />} />
                            <Route path="workspaces/:id/stitches/:stitchId" element={<StitchDetailPage />} />
                            <Route path="workspaces/:id/stitches/:stitchId/traces" element={<PipelineTracePage />} />
                            <Route path="exceptions" element={<ExceptionCenterPage />} />
                        </Route>
                    </Routes>
                </Refine>
            </AppScopeProvider>
        } />
    );
}
