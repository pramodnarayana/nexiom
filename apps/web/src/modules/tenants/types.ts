export interface TenantTableItem {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
    createdAt: Date;
    metadata: string | null;
    status: 'active' | 'disabled' | 'suspended';
}

export interface OrganizationApiResponse {
    id: string;
    name: string;
    slug: string | null;
    logo: string | null;
    createdAt: string;
    metadata: string | null;
    status: 'active' | 'disabled' | 'suspended';
}
