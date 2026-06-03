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
} from '@soopa/database';

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
} from '@soopa/database';

// Engine schema — connection table (single-table Activepieces model)
export { dataSources, credentials } from '@soopa/database';

// Piece registry
export { pieces } from '@soopa/database';

// Infrastructure registry — maps tenant IDs to physical DB location
export { tenantStorageRegistry, shardRegistry } from '@soopa/database';

// Workspaces — logical folders grouping connections per team/environment
export {
  uiWorkspaces,
  uiWorkspaceDataSources,
  uiWorkspaceDataSourceRelations,
  envTypeEnum,
} from '@soopa/database';

// Stitches — integration sync paths between source and destination connections
export {
  integrationStitches,
  fieldMappings,
  stitchStatusEnum,
  integrationStitchesRelations,
  fieldMappingsRelations,
} from '@soopa/database';

// Scheduler — Singer-style polling cursors
// syncCursors: connection-level (keyed by data_source_id)
export { syncCursors } from '@soopa/database';

// Scheduler outbox — durable transactional outbox for Windmill schedule sync
export {
  schedulerOutbox,
  schedulerOutboxActionEnum,
  schedulerOutboxStatusEnum,
} from '@soopa/database';
