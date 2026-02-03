export interface UserTableItem {
    id: string;
    name: string;
    email: string;
    role?: string; // Optional as not all lists might have it joined
    memberRole?: string; // Tenant-specific role from organization membership
    systemRole?: string; // For platform admins
    emailVerified: boolean;
    status?: "active" | "pending" | "disabled" | "suspended";
}
