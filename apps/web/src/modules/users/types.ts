export interface UserTableItem {
    id: string;
    name: string;
    email: string;
    role?: string; // Optional as not all lists might have it joined
    emailVerified: boolean;
}
