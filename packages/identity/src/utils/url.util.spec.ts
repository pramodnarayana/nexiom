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
      const url = "https://app.soopa.com";
      const allowed = ["https://app.soopa.com", "https://staging.soopa.com"];
      expect(validateFrontendUrl(url, allowed)).toBe(url);
    });

    it("does not fall through to the fallback when url matches", () => {
      const url = "https://staging.soopa.com";
      const allowed = ["https://app.soopa.com", "https://staging.soopa.com"];
      expect(validateFrontendUrl(url, allowed)).toBe(
        "https://staging.soopa.com",
      );
    });
  });

  // ─── Fallback behaviour ────────────────────────────────────────────────────

  describe("when url is NOT in allowedOrigins", () => {
    it("returns the first allowed origin as fallback", () => {
      const allowed = ["https://app.soopa.com", "https://staging.soopa.com"];
      expect(validateFrontendUrl("https://evil.example.com", allowed)).toBe(
        "https://app.soopa.com",
      );
    });

    it("returns the first allowed origin when url is undefined", () => {
      const allowed = ["https://app.soopa.com"];
      expect(validateFrontendUrl(undefined, allowed)).toBe(
        "https://app.soopa.com",
      );
    });

    it("returns the first allowed origin when url is an empty string", () => {
      const allowed = ["https://app.soopa.com"];
      expect(validateFrontendUrl("", allowed)).toBe("https://app.soopa.com");
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
      const allowed = ["https://app.soopa.com"];
      expect(validateFrontendUrl("https://app.soopa.com", allowed)).toBe(
        "https://app.soopa.com",
      );
    });

    it("returns that single element as fallback when url does not match", () => {
      const allowed = ["https://app.soopa.com"];
      expect(validateFrontendUrl("https://other.com", allowed)).toBe(
        "https://app.soopa.com",
      );
    });
  });

  // ─── Return-type contract ──────────────────────────────────────────────────

  describe("return-type contract", () => {
    it("always returns a non-empty string", () => {
      const allowed = ["https://app.soopa.com"];
      expect(typeof validateFrontendUrl(undefined, allowed)).toBe("string");
      expect(validateFrontendUrl(undefined, allowed).length).toBeGreaterThan(0);
    });
  });
});
