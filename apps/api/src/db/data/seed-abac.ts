export interface SeedPermission {
  id: string;
  resource: string;
  action: string;
  description: string;
}

export const ABAC_PERMISSIONS: SeedPermission[] = [
  {
    id: 'users:read',
    resource: 'users',
    action: 'read',
    description: 'Read users',
  },
  {
    id: 'users:delete',
    resource: 'users',
    action: 'delete',
    description: 'Delete users',
  },
];
