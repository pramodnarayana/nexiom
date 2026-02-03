
import { useAuth } from '@/shared/lib/auth/context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/shared/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

export function TenantSettingsPage() {
    const { user } = useAuth();

    // Guard: Should interact with the current organization context
    // Ideally use a useOrganization() hook, but useAuth gives us orgId
    const orgId = user?.organizationId;

    if (!orgId) {
        return <div className="p-8 text-center text-muted-foreground">You do not have an organization context.</div>;
    }

    return (
        <div className="container mx-auto py-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold">Organization Settings</h1>
            </div>

            <Tabs defaultValue="general" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="users">Users</TabsTrigger>
                </TabsList>

                <TabsContent value="general">
                    <GeneralSettingsTab orgId={orgId} />
                </TabsContent>

                <TabsContent value="users">
                    <UsersListTab orgId={orgId} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function GeneralSettingsTab({ orgId }: Readonly<{ orgId: string }>) {
    // Fetch organization by ID
    const { data: org, isLoading, isError, error } = useQuery({
        queryKey: ['organization', orgId],
        queryFn: async () => {
            const res = await apiClient.get<{ id: string; name: string; slug: string }>(`/tenants/${orgId}`);
            return res.data;
        }
    });

    if (isError) {
        return (
            <div className="text-center py-8">
                <p className="text-destructive font-medium">Error loading organization</p>
                <p className="text-sm text-muted-foreground mt-2">
                    {error instanceof Error ? error.message : 'An unexpected error occurred'}
                </p>
            </div>
        );
    }

    if (isLoading) return <div>Loading...</div>;
    if (!org) return <div>Organization not found</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Organization Details</CardTitle>
                <CardDescription>Manage your organization's display information.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2">
                    <div className="text-sm font-medium">Fancy Name</div>
                    <div className="p-2 bg-muted rounded">{org.name}</div>
                </div>
                <div className="grid gap-2">
                    <div className="text-sm font-medium">Slug</div>
                    <div className="p-2 bg-muted rounded font-mono text-sm">{org.slug}</div>
                </div>
                <div className="grid gap-2">
                    <div className="text-sm font-medium">Organization ID</div>
                    <div className="p-2 bg-muted rounded font-mono text-xs">{org.id}</div>
                </div>
            </CardContent>
        </Card>
    )
}

function UsersListTab({ orgId }: Readonly<{ orgId: string }>) {
    const { data: users, isLoading, isError, error } = useQuery({
        queryKey: ['users', orgId],
        queryFn: async () => {
            // Tenant-scoped endpoint to prevent cross-tenant data leakage
            const res = await apiClient.get<{ data: Array<{ id: string; name: string; email: string; role: string }> }>(`/tenants/${orgId}/users`);
            return res.data.data;
        }
    });

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Users</CardTitle>
                        <CardDescription>Manage users in your organization.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {isError && (
                    <div className="text-center py-8">
                        <p className="text-destructive font-medium">Failed to load users</p>
                        <p className="text-sm text-muted-foreground mt-2">
                            {error instanceof Error ? error.message : 'An unexpected error occurred'}
                        </p>
                    </div>
                )}

                {!isError && isLoading && (
                    <div>Loading users...</div>
                )}

                {!isError && !isLoading && (
                    <div className="border rounded-md">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 border-b">
                                <tr>
                                    <th scope="col" className="h-10 px-4 text-left font-medium">Name</th>
                                    <th scope="col" className="h-10 px-4 text-left font-medium">Email</th>
                                    <th scope="col" className="h-10 px-4 text-left font-medium">Role</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users?.map((u) => (
                                    <tr key={u.id} className="border-b last:border-0 hover:bg-muted/50">
                                        <td className="p-4">{u.name || '-'}</td>
                                        <td className="p-4">{u.email}</td>
                                        <td className="p-4 capitalize">{u.role}</td>
                                    </tr>
                                ))}
                                {users?.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="p-8 text-center text-muted-foreground">
                                            No users found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
