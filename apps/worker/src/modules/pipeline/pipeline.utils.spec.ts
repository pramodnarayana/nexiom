import { describe, it, expect } from "vitest";
import {
  sanitizeError,
  isRetryableStatusCode,
  extractDestVendorId,
  isValidPipelineMessage,
} from "../../shared/pipeline.utils.js";

describe("pipeline.utils", () => {
  // ── sanitizeError ───────────────────────────────────────────────────────
  describe("sanitizeError()", () => {
    it("returns message from an Error instance", () => {
      expect(sanitizeError(new Error("boom"))).toBe("boom");
    });

    it("stringifies non-Error values", () => {
      expect(sanitizeError("plain string")).toBe("plain string");
      expect(sanitizeError(42)).toBe("42");
      expect(sanitizeError({ x: 1 })).toBe("[object Object]");
    });

    it("redacts URL credentials from error messages", () => {
      const err = new Error(
        "failed: https://user:secret_token@api.vendor.com/v1",
      );
      expect(sanitizeError(err)).toBe(
        "failed: https://[REDACTED]@api.vendor.com/v1",
      );
    });

    it("truncates messages longer than 500 characters", () => {
      const longMsg = "x".repeat(600);
      const result = sanitizeError(new Error(longMsg));
      expect(result).toHaveLength(501); // 500 chars + "…" (1 Unicode character)
      expect(result.endsWith("…")).toBe(true);
    });

    it("does not truncate messages at exactly 500 characters", () => {
      const msg = "x".repeat(500);
      const result = sanitizeError(new Error(msg));
      expect(result).toBe(msg);
    });
  });

  // ── isRetryableStatusCode ───────────────────────────────────────────────
  describe("isRetryableStatusCode()", () => {
    it.each([429, 502, 503, 504])("returns true for %i", (code) => {
      expect(isRetryableStatusCode(code)).toBe(true);
    });

    it.each([200, 400, 401, 403, 404, 422, 500])(
      "returns false for %i",
      (code) => {
        expect(isRetryableStatusCode(code)).toBe(false);
      },
    );
  });

  // ── extractDestVendorId ─────────────────────────────────────────────────
  describe("extractDestVendorId()", () => {
    it("returns undefined for null", () => {
      expect(extractDestVendorId(null)).toBeUndefined();
    });

    it("returns undefined for non-object primitives", () => {
      expect(extractDestVendorId("string")).toBeUndefined();
      expect(extractDestVendorId(42)).toBeUndefined();
    });

    it("extracts lowercase 'id' field", () => {
      expect(extractDestVendorId({ id: "abc123" })).toBe("abc123");
    });

    it("extracts Salesforce-style uppercase 'Id' field", () => {
      expect(extractDestVendorId({ Id: "SF_001" })).toBe("SF_001");
    });

    it("extracts wrapped 'result.id' field", () => {
      expect(extractDestVendorId({ result: { id: "r_99" } })).toBe("r_99");
    });

    it("extracts envelope 'data.id' field", () => {
      expect(extractDestVendorId({ data: { id: "d_77" } })).toBe("d_77");
    });

    it("returns undefined when no recognised ID field is present", () => {
      expect(extractDestVendorId({ name: "no-id-here" })).toBeUndefined();
    });

    it("returns undefined when id field is an empty string", () => {
      expect(extractDestVendorId({ id: "" })).toBeUndefined();
    });
  });

  // ── isValidPipelineMessage ──────────────────────────────────────────────
  describe("isValidPipelineMessage()", () => {
    it("returns true when all required fields are non-empty strings", () => {
      expect(
        isValidPipelineMessage({ traceId: "t1", connectionId: "c1" }, [
          "traceId",
          "connectionId",
        ]),
      ).toBe(true);
    });

    it("returns false when a required field is missing", () => {
      expect(
        isValidPipelineMessage({ traceId: "t1" }, ["traceId", "connectionId"]),
      ).toBe(false);
    });

    it("returns false when a required field is an empty string", () => {
      expect(
        isValidPipelineMessage({ traceId: "", connectionId: "c1" }, [
          "traceId",
          "connectionId",
        ]),
      ).toBe(false);
    });

    it("returns false when a required field is not a string", () => {
      expect(
        isValidPipelineMessage(
          { traceId: 42, connectionId: "c1" } as unknown as Record<
            string,
            unknown
          >,
          ["traceId", "connectionId"],
        ),
      ).toBe(false);
    });

    it("returns true for empty required-fields list", () => {
      expect(isValidPipelineMessage({}, [])).toBe(true);
    });
  });
});
