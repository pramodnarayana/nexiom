import { useTable, useList } from "@refinedev/core";

import { Users } from "./Users";
import { type UserTableItem } from "./types";
import { InviteMemberDialog } from "../invitations/InviteMemberDialog";

interface UserListProps {
    basePath: string;
    resource?: string;
    inviteResource?: string;
}

export const UserList = ({
    basePath,
    resource = "users",
    inviteResource = "invitations"
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
        emailVerified: user.emailVerified,
        status: "active"
    })) || [];

    // Fetch Invitations with Refine's Data Hook (Conditional)
    const { data: inviteData, isLoading: isLoadingInvites } = useList({
        resource: inviteResource || "invitations", // Default to satisfy hook, but we'll gate usage
        queryOptions: {
            enabled: !!inviteResource, // Only fetch if resource provided
        }
    });

    const invitations: UserTableItem[] = (inviteResource && inviteData?.data) ? inviteData.data.map((invite) => ({
        id: String(invite.id),
        name: "Invited Member",
        email: invite.email,
        role: invite.role,
        status: "pending",
        emailVerified: false
    })) : [];

    // Merge and Sort (Invitations First)
    const combinedData = [...invitations, ...users];
    const isLoadingCombined = isLoading || isLoadingInvites;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end">
                <InviteMemberDialog />
            </div>

            <Users
                data={combinedData}
                isLoading={isLoadingCombined}
                basePath={basePath}
            />

            <div className="flex items-center justify-end space-x-2 py-4">
                {/* Pagination - to be implemented with table.getState().pagination */}
                <div className="text-xs text-muted-foreground mr-4">
                    Total Users: {data?.total || 0} | Pending Invites: {inviteData?.total || 0}
                </div>
            </div>
        </div>
    );
};
