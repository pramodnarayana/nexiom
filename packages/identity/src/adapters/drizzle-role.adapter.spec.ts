import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { DrizzleRoleAdapter } from "./drizzle-role.adapter.js";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../schema.js";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// Mock uuid
vi.mock("uuid", () => ({
  v4: vi.fn(),
}));

// Mock DB
type MockDb = {
  insert: Mock;
  values: Mock;
  returning: Mock;
  update: Mock;
  set: Mock;
  where: Mock;
  delete: Mock;
  query: {
    role: {
      findMany: Mock;
      findFirst: Mock;
    };
  };
};

const mkDb = () => {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    query: {
      role: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
  } as unknown as NodePgDatabase<typeof schema> & MockDb;
  return db;
};

describe("DrizzleRoleAdapter", () => {
  let db: NodePgDatabase<typeof schema> & MockDb;
  let adapter: DrizzleRoleAdapter;

  beforeEach(() => {
    db = mkDb();
    adapter = new DrizzleRoleAdapter(db);
    vi.mocked(uuidv4).mockReturnValue(
      "test-uuid" as unknown as ReturnType<typeof uuidv4>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findAll", () => {
    type FindManyArgs = {
      where?: (role: unknown, ops: { eq: Mock }) => unknown;
      orderBy?: unknown[];
    };

    it("should return all roles when no scope is provided", async () => {
      const mockRoles = [{ id: "1", name: "Admin" }];
      db.query.role.findMany.mockResolvedValue(mockRoles);

      const result = await adapter.findAll();

      expect(result).toEqual(mockRoles);

      const args = db.query.role.findMany.mock.calls[0][0] as FindManyArgs;
      expect(args.orderBy).toEqual([desc(schema.role.createdAt)]);

      // Execute the where function to verify it returns undefined
      const whereFn = args.where;
      const mockEq = vi.fn();
      expect(whereFn).toBeDefined();
      if (whereFn) {
        const res = whereFn(schema.role, { eq: mockEq });
        expect(res).toBeUndefined();
      }
    });

    it("should filter by system scope", async () => {
      const mockRoles = [{ id: "1", name: "Owner", isSystem: true }];
      db.query.role.findMany.mockResolvedValue(mockRoles);

      await adapter.findAll({ scope: "system" });

      const args = db.query.role.findMany.mock.calls[0][0] as FindManyArgs;
      expect(args.orderBy).toEqual([desc(schema.role.createdAt)]);

      // Verify where function logic
      const whereFn = args.where;
      const mockEq = vi.fn().mockReturnValue("eq-result");

      expect(whereFn).toBeDefined();
      if (whereFn) {
        const res = whereFn(schema.role, { eq: mockEq });
        expect(mockEq).toHaveBeenCalledWith(schema.role.isSystem, true);
        expect(res).toBe("eq-result");
      }
    });

    it("should filter by organization scope", async () => {
      const mockRoles = [{ id: "2", name: "Member", isSystem: false }];
      db.query.role.findMany.mockResolvedValue(mockRoles);

      await adapter.findAll({ scope: "organization" });

      const args = db.query.role.findMany.mock.calls[0][0] as FindManyArgs;
      expect(args.orderBy).toEqual([desc(schema.role.createdAt)]);

      // Verify where function logic
      const whereFn = args.where;
      const mockEq = vi.fn().mockReturnValue("eq-result");

      expect(whereFn).toBeDefined();
      if (whereFn) {
        const res = whereFn(schema.role, { eq: mockEq });
        expect(mockEq).toHaveBeenCalledWith(schema.role.isSystem, false);
        expect(res).toBe("eq-result");
      }
    });
  });

  describe("findById", () => {
    it("should return a role if found", async () => {
      const mockRole = { id: "1", name: "Admin" };
      db.query.role.findFirst.mockResolvedValue(mockRole);

      const result = await adapter.findById("1");

      expect(result).toEqual(mockRole);
      expect(db.query.role.findFirst).toHaveBeenCalledWith({
        where: eq(schema.role.id, "1"),
      });
    });

    it("should return null if not found", async () => {
      db.query.role.findFirst.mockResolvedValue(undefined);

      const result = await adapter.findById("999");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("should insert and return a new role", async () => {
      const input = { name: "New Role", description: "Desc", isSystem: true };
      const mockRole = { id: "test-uuid", ...input };
      db.returning.mockResolvedValue([mockRole]);

      const result = await adapter.create(input);

      expect(result).toEqual(mockRole);
      expect(db.insert).toHaveBeenCalledWith(schema.role);
      expect(db.values).toHaveBeenCalledWith({
        id: "test-uuid",
        name: input.name,
        description: input.description,
        isSystem: input.isSystem,
      });
    });

    it("should default isSystem to false", async () => {
      const input = { name: "New Role" };
      const mockRole = { id: "test-uuid", name: "New Role", isSystem: false };
      db.returning.mockResolvedValue([mockRole]);

      await adapter.create(input);

      expect(db.values).toHaveBeenCalledWith({
        id: "test-uuid",
        name: input.name,
        description: undefined,
        isSystem: false,
      });
    });
  });

  describe("update", () => {
    it("should update and return the role", async () => {
      const input = { name: "Updated Name" };
      const mockRole = { id: "1", name: "Updated Name" };
      db.returning.mockResolvedValue([mockRole]);

      const result = await adapter.update("1", input);

      expect(result).toEqual(mockRole);
      expect(db.update).toHaveBeenCalledWith(schema.role);
      expect(db.set).toHaveBeenCalledWith({ name: "Updated Name" });
      expect(db.where).toHaveBeenCalledWith(eq(schema.role.id, "1"));
    });

    it("should throw error if role not found", async () => {
      db.returning.mockResolvedValue([]);

      await expect(adapter.update("1", { name: "Update" })).rejects.toThrow(
        "Role not found",
      );
    });
  });

  describe("delete", () => {
    it("should delete successfully", async () => {
      db.returning.mockResolvedValue([{ id: "1" }]);

      await expect(adapter.delete("1")).resolves.not.toThrow();
      expect(db.delete).toHaveBeenCalledWith(schema.role);
      expect(db.where).toHaveBeenCalledWith(eq(schema.role.id, "1"));
    });

    it("should throw if not found", async () => {
      db.returning.mockResolvedValue([]);

      await expect(adapter.delete("1")).rejects.toThrow("Role not found");
    });
  });
});
