import { describe, it, expect } from "vitest";
import { filterRolesForRequester } from "./role-visibility.js";

/**
 * TDD spec for filterRolesForRequester()
 *
 * Pure function — zero mocks required.
 * Enforces the privilege-escalation prevention contract:
 *   - Only 'Owner' can see/assign the 'Owner' role.
 *   - Every other role sees all roles EXCEPT 'Owner'.
 */
describe("filterRolesForRequester", () => {
  const allRoles = [
    { id: "r1", name: "owner" },
    { id: "r2", name: "admin" },
    { id: "r3", name: "member" },
  ];

  // ─── Owner requester ────────────────────────────────────────────────────────

  describe("when requesterRole is 'owner'", () => {
    it("returns all roles including owner", () => {
      const result = filterRolesForRequester(allRoles, "owner");
      expect(result).toEqual(allRoles);
    });

    it("is case-insensitive — 'Owner' also sees all roles", () => {
      const result = filterRolesForRequester(allRoles, "Owner");
      expect(result).toEqual(allRoles);
    });

    it("is case-insensitive — 'OWNER' also sees all roles", () => {
      const result = filterRolesForRequester(allRoles, "OWNER");
      expect(result).toEqual(allRoles);
    });
  });

  // ─── Non-owner requester ───────────────────────────────────────────────────

  describe("when requesterRole is 'admin'", () => {
    it("excludes the owner role", () => {
      const result = filterRolesForRequester(allRoles, "admin");
      const names = result.map((r) => r.name);
      expect(names).not.toContain("owner");
    });

    it("still includes admin and member roles", () => {
      const result = filterRolesForRequester(allRoles, "admin");
      const names = result.map((r) => r.name);
      expect(names).toContain("admin");
      expect(names).toContain("member");
    });
  });

  describe("when requesterRole is 'member'", () => {
    it("excludes the owner role", () => {
      const result = filterRolesForRequester(allRoles, "member");
      expect(result.map((r) => r.name)).not.toContain("owner");
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty array when roles list is empty", () => {
      expect(filterRolesForRequester([], "admin")).toEqual([]);
    });

    it("returns empty array when roles list is empty even for owner", () => {
      expect(filterRolesForRequester([], "owner")).toEqual([]);
    });

    it("handles requesterRole as empty string — excludes owner", () => {
      const result = filterRolesForRequester(allRoles, "");
      expect(result.map((r) => r.name)).not.toContain("owner");
    });

    it("works with generic T that extends { name: string }", () => {
      const richRoles = [
        { id: "r1", name: "owner", displayLabel: "Owner Role" },
        { id: "r2", name: "admin", displayLabel: "Admin Role" },
      ];
      const result = filterRolesForRequester(richRoles, "admin");
      expect(result).toHaveLength(1);
      expect(result[0].displayLabel).toBe("Admin Role");
    });

    it("does not mutate the original roles array", () => {
      const original = [...allRoles];
      filterRolesForRequester(allRoles, "admin");
      expect(allRoles).toEqual(original);
    });

    it("preserves all role fields on matching items", () => {
      const result = filterRolesForRequester(allRoles, "admin");
      const adminRole = result.find((r) => r.name === "admin");
      expect(adminRole).toEqual({ id: "r2", name: "admin" });
    });
  });

  // ─── Case sensitivity for role names in the list ───────────────────────────

  describe("when 'Owner' role name has different casing in list", () => {
    it("excludes 'Owner' (capital O) when requester is non-owner", () => {
      const mixedRoles = [{ name: "Owner" }, { name: "admin" }];
      const result = filterRolesForRequester(mixedRoles, "admin");
      expect(result.map((r) => r.name)).not.toContain("Owner");
    });

    it("includes 'Owner' when requester is owner regardless of name casing", () => {
      const mixedRoles = [{ name: "Owner" }, { name: "admin" }];
      const result = filterRolesForRequester(mixedRoles, "owner");
      expect(result).toEqual(mixedRoles);
    });
  });
});
