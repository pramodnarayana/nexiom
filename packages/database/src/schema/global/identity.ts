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
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// --- User Schema ---
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
  /**
   * LEGACY FIELD: Global platform role designation (non-authoritative)
   *
   * **IMPORTANT**: This field is a TRANSIENT fallback only and should NOT be used for
   * permission checks. The authoritative role for RBAC is `member.role` (FK to role table).
   *
   * **Architecture**:
   * - `user.role`: Legacy global label, defaults to 'member'. Not tied to RBAC system.
   * - `member.role`: Authoritative organization-scoped role (FK to role table) used for
   *   all permission checks via RBAC.
   *
   * **When to use**:
   * - `user.role`: ONLY as migration fallback in UI (e.g., `member.role ?? user.role`)
   *   when member record doesn't exist yet. Do NOT use for authorization.
   * - `member.role`: ALWAYS use for permission checks and authorization logic.
   *
   * **Migration Path**: This field exists for backward compatibility during migration from
   * global roles to organization-scoped RBAC. Once all users have member records, this field
   * can be deprecated and removed.
   *
   * @deprecated Use member.role for all authorization and permission checks
   */
  role: text("role").default("member"),
  banned: boolean("banned"),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires", { withTimezone: true }),
  deletedAt: timestamp("deletedAt", { withTimezone: true }),
});

export const userRelations = relations(user, ({ many }) => ({
  members: many(member),
}));

// --- Auth Tables ---
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
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
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
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
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }),
  updatedAt: timestamp("updatedAt", { withTimezone: true }),
});

// --- RBAC Tables ---
export const permission = pgTable(
  "permission",
  {
    id: text("id").primaryKey(), // e.g., 'users:read'
    resource: text("resource").notNull(), // e.g., 'users'
    action: text("action").notNull(), // e.g., 'read'
    description: text("description"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    /**
     * ABAC Conditions (JSON)
     * Stores dynamic conditions for this permission assignment.
     * Example: { "department": "engineering", "public": true }
     */
    conditions: jsonb("conditions").$type<AbacConditions>(),
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
    slug: text("slug"),
    logo: text("logo"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /**
     * Organization metadata (JSON).
     * Supported schema:
     * {
     *   tier: 'standard' | 'enterprise'
     * }
     */
    metadata: text("metadata"),
    status: organizationStatusEnum("status").default("active").notNull(),
    isSystem: boolean("isSystem").default(false).notNull(),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  (table) => [
    check("organization_id_not_sentinel", sql`${table.id} <> '__NULL__'`),
    // Partial unique index: enforce slug uniqueness only for non-deleted orgs
    uniqueIndex("organization_slug_unique_idx")
      .on(table.slug)
      .where(sql`"deletedAt" IS NULL`),
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
    organizationId: text("organizationId")
      .notNull()
      .references(() => organization.id, {
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
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("member_user_org_unique")
      .on(table.userId, table.organizationId)
      .where(sql`${table.deletedAt} IS NULL`),
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
  organizationId: text("organizationId")
    .notNull()
    .references(() => organization.id, {
      onDelete: "cascade",
    }),
  email: text("email").notNull(),
  role: text("role").references(() => role.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  inviterId: text("inviterId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type AbacValue = string | number | boolean | null | string[];
export type AbacOperator = {
  $eq?: AbacValue;
  $ne?: AbacValue;
  $in?: AbacValue[];
  $nin?: AbacValue[];
  $lt?: number;
  $lte?: number;
  $gt?: number;
  $gte?: number;
  $exists?: boolean;
};
export type AbacConditions = Record<string, AbacValue | AbacOperator>;
export type Permission = typeof permission.$inferSelect;
