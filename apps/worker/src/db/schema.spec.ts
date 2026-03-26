import * as schema from "./schema.js";

describe("Database Schema", () => {
  describe("Table Exports", () => {
    it("should export user table", () => {
      expect(schema.user).toBeDefined();
      expect(typeof schema.user).toBe("object");
    });

    it("should export session table", () => {
      expect(schema.session).toBeDefined();
      expect(typeof schema.session).toBe("object");
    });

    it("should export account table", () => {
      expect(schema.account).toBeDefined();
      expect(typeof schema.account).toBe("object");
    });

    it("should export verification table", () => {
      expect(schema.verification).toBeDefined();
      expect(typeof schema.verification).toBe("object");
    });

    it("should export organization table", () => {
      expect(schema.organization).toBeDefined();
      expect(typeof schema.organization).toBe("object");
    });

    it("should export member table", () => {
      expect(schema.member).toBeDefined();
      expect(typeof schema.member).toBe("object");
    });
  });

  describe("Enum Exports", () => {
    it("should export organizationStatusEnum", () => {
      expect(schema.organizationStatusEnum).toBeDefined();
    });
  });

  describe("Schema Structure", () => {
    it("should export all auth tables", () => {
      expect(schema.user).toBeDefined();
      expect(schema.session).toBeDefined();
      expect(schema.account).toBeDefined();
      expect(schema.verification).toBeDefined();
    });

    it("should export all tenant tables", () => {
      expect(schema.organization).toBeDefined();
      expect(schema.member).toBeDefined();
    });
  });
});
