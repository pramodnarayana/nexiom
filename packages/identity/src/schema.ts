import {
  pgTable,
  text,
  timestamp,
  boolean,
  pgEnum,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
export const permission = pgTable("permission", {
  id: text("id").primaryKey(), // e.g., 'users:read'
  resource: text("resource").notNull(), // e.g., 'users'
  action: text("action").notNull(), // e.g., 'read'
  description: text("description"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const role = pgTable("role", {
  id: text("id").primaryKey(), // e.g., 'admin', 'user'
  name: text("name").notNull(), // e.g., 'Admin', 'User'
  description: text("description"),
  isSystem: boolean("isSystem").default(false).notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: text("roleId")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: text("permissionId")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
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

export const organization = pgTable("organization", {
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
  deletedAt: timestamp("deletedAt"),
});

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
      .references(() => organization.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    roleId: text("roleId")
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
    fields: [member.roleId],
    references: [role.id],
  }),
}));

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId").references(() => organization.id),
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
