// Central schema re-export for Drizzle ORM
// This file aggregates all schema definitions from different modules

// Import directly from schema source file to avoid pulling in adapters/decorators from package index
export {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  role,
  permission,
  rolePermission,
  userRelations,
  sessionRelations,
  accountRelations,
  organizationRelations,
  memberRelations,
  invitationRelations,
  roleRelations,
  permissionRelations,
  rolePermissionRelations,
  organizationStatusEnum,
} from '@nexiom/identity/schema';

export type {
  User,
  Session,
  Organization,
  Member,
  Invitation,
  Role,
  Permission,
  RolePermission,
  Account,
  Verification,
  AbacConditions,
} from '@nexiom/identity/src/schema';

// Engine schema — connection table (single-table Activepieces model)
export { appConnections } from '@nexiom/database';
