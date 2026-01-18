export interface TenantTableItem {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
    createdAt: Date;
    updatedAt: Date;
    metadata: string | null;
    status: 'active' | 'disabled' | 'suspended';
}

export interface TenantApiResponse {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
    createdAt: string;
    updatedAt: string;
    metadata: string | null;
    status: 'active' | 'disabled' | 'suspended';
}
