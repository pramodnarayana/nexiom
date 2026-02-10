import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  unique,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// --- User Schema ---
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  role: text("role").default("user"),
  banned: boolean("banned"),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires"),
  deletedAt: timestamp("deletedAt"),
});

export const userRelations = relations(user, ({ many }) => ({
  members: many(member),
}));

// --- Auth Tables ---
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  // PII / Retention Policy:
  // IP Address and User Agent containing PII should be anonymized or retained only for
  // a limited period (e.g., 30 days) for security auditing, then purged.
  // TASK: Implement scheduled PII cleanup (Issue #TRACK-142)
  // - Criteria: Run daily, older than 30d, anonymize fields, audit log
  // - Owner: Security Team
  // - Implementation: Create `runPIICleanup` job in background module
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonatedBy").references(() => user.id, {
    onDelete: "cascade",
  }),
});

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Security: Tokens typically should be encrypted at rest if they provide offline access.
    // Passwords must be hashed (handled by BetterAuth adapter config).
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt").notNull(),
    updatedAt: timestamp("updatedAt").notNull(),
  },
  (table) => [
    unique("account_user_provider_unique").on(table.userId, table.providerId),
    unique("account_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// --- RBAC Tables ---
export const permission = pgTable(
  "permission",
  {
    id: text("id").primaryKey(), // e.g., 'users:read'
    resource: text("resource").notNull(), // e.g., 'users'
    action: text("action").notNull(), // e.g., 'read'
    description: text("description"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    // Enforce unique (resource, action) pair to prevent duplicate definitions
    unique("permission_resource_action_unique").on(t.resource, t.action),
  ],
);

export const role = pgTable(
  "role",
  {
    id: text("id").primaryKey(), // e.g., 'admin', 'user'
    name: text("name").notNull(), // e.g., 'Admin', 'User'
    description: text("description"),
    isSystem: boolean("isSystem").default(false).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [
    // Enforce unique role name
    unique("role_name_unique").on(t.name),
  ],
);

export const rolePermission = pgTable(
  "role_permission",
  {
    id: text("id").primaryKey(), // Surrogate PK
    roleId: text("roleId")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: text("permissionId")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
    organizationId: text("organizationId").references(() => organization.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    // Surrogate PK
    // Note: Use 'unique().nullsNotDistinct()' for simpler unique constraints if on PG15+,
    // OR use the sql implementation for robustness across versions/drivers as suggested.
    // User requested "unique index on (roleId, permissionId, COALESCE(organizationId, '__NULL__'))"
    // Also requested "index for fast lookup" on organizationId.
    index("idx_role_permission_org_id").on(t.organizationId),
    // Advisory unique index for nullable organizationId to prevent duplicates in code-logic
    // Sentinel value '__NULL__' chosen to avoid collision with real UUIDs/IDs.
    // Invariant: No organization shall ever have the ID '__NULL__'.
    uniqueIndex("idx_role_permission_unique").on(
      t.roleId,
      t.permissionId,
      sql`COALESCE("organizationId", '__NULL__')`,
    ),
  ],
);

// --- RBAC Relations ---
export const roleRelations = relations(role, ({ many }) => ({
  permissions: many(rolePermission),
  members: many(member),
}));

export const permissionRelations = relations(permission, ({ many }) => ({
  roles: many(rolePermission),
}));

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
  role: one(role, {
    fields: [rolePermission.roleId],
    references: [role.id],
  }),
  permission: one(permission, {
    fields: [rolePermission.permissionId],
    references: [permission.id],
  }),
}));

// --- Tenant Schema ---
export const organizationStatusEnum = pgEnum("organization_status", [
  "active",
  "disabled",
  "suspended",
]);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
    logo: text("logo"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    metadata: text("metadata"),
    status: organizationStatusEnum("status").default("active").notNull(),
    isSystem: boolean("isSystem").default(false).notNull(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [
    check("organization_id_not_sentinel", sql`${table.id} <> '__NULL__'`),
  ],
);

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // NOTE: Column is named "role" (not "roleId") to match better-auth's organization plugin expectation.
    // Do not rename to roleId without configuring better-auth to map it.
    role: text("role")
      .notNull()
      .references(() => role.id, { onDelete: "restrict" }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    deletedAt: timestamp("deletedAt"),
  },
  (table) => [
    unique("member_org_user_unique").on(table.organizationId, table.userId),
    index("member_user_idx").on(table.userId),
    index("member_org_idx").on(table.organizationId),
  ],
);

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  role: one(role, {
    fields: [member.role],
    references: [role.id],
  }),
}));

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId").references(() => organization.id, {
    onDelete: "cascade",
  }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  inviterId: text("inviterId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type Member = typeof member.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type Role = typeof role.$inferSelect;
export type RolePermission = typeof rolePermission.$inferSelect;
