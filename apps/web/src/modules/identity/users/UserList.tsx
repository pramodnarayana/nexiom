import { useTable, useCan } from "@refinedev/core";

import { Users } from "./Users";
import { type UserTableItem } from "./types";
import { InviteUserDialog } from "./InviteUserDialog";

interface UserListProps {
    basePath: string;
    resource?: string;
}

export const UserList = ({
    basePath,
    resource = "users",
}: UserListProps) => {
    // Permission Check: Can create users?
    const { data: canCreate } = useCan({
        resource: resource,
        action: "create",
    });

    // HEADLESS MAGIC: Refine handles fetching, pagination, sorting
    const table = useTable<UserTableItem>({
        resource: resource,

        // Initial sorting
        initialSorter: [
            {
                field: "createdAt",
                order: "desc",
            },
        ],
        // Fetch users based on resource (admin vs tenant is handled by resource + auth)
        syncWithLocation: true,
    });

    const {
        tableQuery,
    } = table;

    const { data, isLoading } = tableQuery;

    if (tableQuery?.error) {
        console.error("Error loading users:", tableQuery.error);

        return (
            <div className="p-4 text-sm text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded">
                Error loading users: {tableQuery?.error?.message || "Unable to load users"}
            </div>
        );
    }

    // Transform data to match shared component interface
    const users: UserTableItem[] = data?.data?.map((user) => ({
        id: user.id,
        name: user.name ?? (user.status === 'pending' ? 'Invited User' : ''),
        email: user.email,
        role: user.memberRole ?? user.role, // Use memberRole if available (tenant view), fallback to global role
        emailVerified: user.emailVerified,
        status: user.status ?? "active" // Use API status (pending/active), fallback to active for legacy
    })) || [];

    return (
        <div className="space-y-4">
            {canCreate?.can && (
                <div className="flex items-center justify-end">
                    <InviteUserDialog resource={resource} />
                </div>
            )}

            <Users
                data={users}
                isLoading={isLoading}
                basePath={basePath}
                resource={resource}
            />

            <div className="flex items-center justify-end space-x-2 py-4">
                {/* Pagination - to be implemented with table.getState().pagination */}
                <div className="text-xs text-muted-foreground mr-4">
                    Total Users: {data?.total || 0}
                </div>
            </div>
        </div>
    );
};
