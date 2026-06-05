import { describe, it, expect } from "vitest";
import { validateFrontendUrl } from "./url.util.js";

/**
 * TDD spec for validateFrontendUrl()
 *
 * Pure function — zero mocks required.
 */
describe("validateFrontendUrl", () => {
  // ─── Happy path ────────────────────────────────────────────────────────────

  describe("when url is in allowedOrigins", () => {
    it("returns the url unchanged", () => {
      const url = "https://app.nexiom.io";
      const allowed = ["https://app.nexiom.io", "https://staging.nexiom.io"];
      expect(validateFrontendUrl(url, allowed)).toBe(url);
    });

    it("does not fall through to the fallback when url matches", () => {
      const url = "https://staging.nexiom.io";
      const allowed = ["https://app.nexiom.io", "https://staging.nexiom.io"];
      expect(validateFrontendUrl(url, allowed)).toBe(
        "https://staging.nexiom.io",
      );
    });
  });

  // ─── Fallback behaviour ────────────────────────────────────────────────────

  describe("when url is NOT in allowedOrigins", () => {
    it("returns the first allowed origin as fallback", () => {
      const allowed = ["https://app.nexiom.io", "https://staging.nexiom.io"];
      expect(validateFrontendUrl("https://evil.example.com", allowed)).toBe(
        "https://app.nexiom.io",
      );
    });

    it("returns the first allowed origin when url is undefined", () => {
      const allowed = ["https://app.nexiom.io"];
      expect(validateFrontendUrl(undefined, allowed)).toBe(
        "https://app.nexiom.io",
      );
    });

    it("returns the first allowed origin when url is an empty string", () => {
      const allowed = ["https://app.nexiom.io"];
      expect(validateFrontendUrl("", allowed)).toBe("https://app.nexiom.io");
    });
  });

  // ─── Error cases ───────────────────────────────────────────────────────────

  describe("when allowedOrigins is empty", () => {
    it("throws an error", () => {
      expect(() => validateFrontendUrl("https://anything.com", [])).toThrow(
        "allowedOrigins cannot be empty",
      );
    });
  });

  describe("when allowedOrigins is a single-element list", () => {
    it("returns that single element when url matches", () => {
      const allowed = ["https://app.nexiom.io"];
      expect(validateFrontendUrl("https://app.nexiom.io", allowed)).toBe(
        "https://app.nexiom.io",
      );
    });

    it("returns that single element as fallback when url does not match", () => {
      const allowed = ["https://app.nexiom.io"];
      expect(validateFrontendUrl("https://other.com", allowed)).toBe(
        "https://app.nexiom.io",
      );
    });
  });

  // ─── Return-type contract ──────────────────────────────────────────────────

  describe("return-type contract", () => {
    it("always returns a non-empty string", () => {
      const allowed = ["https://app.nexiom.io"];
      expect(typeof validateFrontendUrl(undefined, allowed)).toBe("string");
      expect(validateFrontendUrl(undefined, allowed).length).toBeGreaterThan(0);
    });
  });
});
