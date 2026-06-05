import { describe, it, expect } from "vitest";
import { normalizeRole } from "./role-normalization.js";
import type { NormalizedRole } from "./role-normalization.js";

/**
 * TDD spec for normalizeRole()
 *
 * This is pure logic — zero mocks required.
 * Tests define the contract; the implementation must satisfy them.
 */
describe("normalizeRole", () => {
  // ─── String inputs ─────────────────────────────────────────────────────────

  describe("given a plain string role", () => {
    it("uses the string as both id and name", () => {
      const result = normalizeRole("admin");
      expect(result.id).toBe("admin");
      expect(result.name).toBe("admin");
    });

    it("returns an empty permissions array", () => {
      expect(normalizeRole("member").permissions).toEqual([]);
    });

    it("handles the owner string", () => {
      const result = normalizeRole("owner");
      expect(result.id).toBe("owner");
      expect(result.name).toBe("owner");
    });
  });

  // ─── Object inputs ─────────────────────────────────────────────────────────

  describe("given a well-formed role object", () => {
    it("extracts id and name", () => {
      const result = normalizeRole({
        id: "role-uuid",
        name: "admin",
        permissions: [],
      });
      expect(result.id).toBe("role-uuid");
      expect(result.name).toBe("admin");
    });

    it("extracts permissions that have a permissionId", () => {
      const perm = {
        permissionId: "users:read",
        permission: { action: "read", resource: "users" },
      };
      const result = normalizeRole({
        id: "r1",
        name: "admin",
        permissions: [perm],
      });
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0].permissionId).toBe("users:read");
      expect(result.permissions[0].permission).toEqual({
        action: "read",
        resource: "users",
      });
    });

    it("filters out permission entries that lack permissionId", () => {
      const validPerm = { permissionId: "users:read" };
      const invalidPerm = { action: "read" }; // no permissionId
      const result = normalizeRole({
        id: "r1",
        name: "admin",
        permissions: [validPerm, invalidPerm],
      });
      expect(result.permissions).toHaveLength(1);
    });

    it("handles permissions with JSONB conditions", () => {
      const perm = {
        permissionId: "tenants:manage",
        conditions: { tenantId: "t-123" },
        permission: { action: "manage", resource: "tenants" },
      };
      const result = normalizeRole({
        id: "r1",
        name: "owner",
        permissions: [perm],
      });
      expect(result.permissions[0].conditions).toEqual({ tenantId: "t-123" });
    });

    it("returns empty permissions array when permissions field is absent", () => {
      const result = normalizeRole({ id: "r1", name: "member" });
      expect(result.permissions).toEqual([]);
    });

    it("returns empty permissions array when permissions field is null", () => {
      const result = normalizeRole({
        id: "r1",
        name: "member",
        permissions: null,
      });
      expect(result.permissions).toEqual([]);
    });
  });

  // ─── Fallback / unknown inputs ─────────────────────────────────────────────

  describe("given unknown / nullish input", () => {
    it("returns id='unknown', name='unknown', permissions=[] for null", () => {
      const result = normalizeRole(null);
      expect(result).toEqual<NormalizedRole>({
        id: "unknown",
        name: "unknown",
        permissions: [],
      });
    });

    it("returns unknown sentinel for undefined", () => {
      const result = normalizeRole(undefined);
      expect(result.id).toBe("unknown");
      expect(result.name).toBe("unknown");
    });

    it("returns unknown sentinel for a number", () => {
      const result = normalizeRole(42);
      expect(result.id).toBe("unknown");
    });

    it("returns unknown sentinel for an object missing id or name", () => {
      const result = normalizeRole({ foo: "bar" });
      expect(result.id).toBe("unknown");
      expect(result.name).toBe("unknown");
    });

    it("returns unknown sentinel for an empty object", () => {
      const result = normalizeRole({});
      expect(result.id).toBe("unknown");
    });
  });

  // ─── Return-type contract ──────────────────────────────────────────────────

  describe("return-type contract", () => {
    it("always returns an object with id, name, permissions", () => {
      for (const input of [null, undefined, "member", { id: "x", name: "y" }]) {
        const result = normalizeRole(input);
        expect(typeof result.id).toBe("string");
        expect(typeof result.name).toBe("string");
        expect(Array.isArray(result.permissions)).toBe(true);
      }
    });
  });
});
