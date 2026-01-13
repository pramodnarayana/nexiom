import { useTable } from "@refinedev/core";

import { Users } from "./Users";
import { type UserTableItem } from "./types";
import { InviteMemberDialog } from "../invitations/InviteMemberDialog";

interface UserListProps {
    basePath: string;
}

export const UserList = ({ basePath }: UserListProps) => {
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
        role: user.role,
        emailVerified: user.emailVerified
    })) || [];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end">
                <InviteMemberDialog />
            </div>

            <Users
                data={users}
                isLoading={isLoading}
                basePath={basePath}
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
