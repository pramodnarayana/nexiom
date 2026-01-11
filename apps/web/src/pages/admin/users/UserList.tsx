import { useTable } from "@refinedev/core";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Users } from "@/modules/users/Users";
import { type UserTableItem } from "@/modules/users/types";

export const UserList = () => {
    // HEADLESS MAGIC: Refine handles fetching, pagination, sorting
    const table = useTable<UserTableItem>({
        resource: "users",
        syncWithLocation: true,
    });

    const { tableQueryResult } = table;
    const { data, isLoading } = tableQueryResult || {};

    // Transform data to match shared component interface
    const users: UserTableItem[] = data?.data?.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role, // Now safely typed
        emailVerified: user.emailVerified
    })) || [];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Users</h2>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add User
                </Button>
            </div>

            <Users
                data={users}
                isLoading={isLoading}
                basePath="/admin/users"
            />

            <div className="flex items-center justify-end space-x-2 py-4">
                {/* Pagination - to be implemented with table.getState().pagination */}
                <div className="text-xs text-muted-foreground mr-4">
                    Total: {data?.total || 0}
                </div>
            </div>
        </div>
    );
};
