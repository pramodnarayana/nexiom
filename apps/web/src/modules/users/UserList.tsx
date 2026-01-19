import { useTable } from "@refinedev/core";

import { Users } from "./Users";
import { type UserTableItem } from "./types";
import { CreateUserDialog } from "./CreateUserDialog";

interface UserListProps {
    basePath: string;
    resource?: string;
}

export const UserList = ({
    basePath,
    resource = "users",
}: UserListProps) => {
    // HEADLESS MAGIC: Refine handles fetching, pagination, sorting
    const table = useTable<UserTableItem>({
        resource: resource,
        syncWithLocation: true,
    });

    const { tableQueryResult } = table;
    const { data, isLoading } = tableQueryResult || {};

    // Transform data to match shared component interface
    const users: UserTableItem[] = data?.data?.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        systemRole: user.systemRole,
        emailVerified: user.emailVerified,
        status: "active"
    })) || [];

    if (tableQueryResult?.error) {
        console.error("Error loading users:", tableQueryResult.error);

        return (
            <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
                Error loading users: {tableQueryResult?.error?.message || "Unable to load users"}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end">
                <CreateUserDialog />
            </div>

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
