import { describe, it, expect } from "vitest";
import { processInChunks } from "./outbox.utils.js";

describe("processInChunks", () => {
  it("should process all items and return settled results", async () => {
    const results = await processInChunks([1, 2, 3, 4, 5], 2, (n) =>
      Promise.resolve(n * 2),
    );
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const values = results.map(
      (r) => (r as PromiseFulfilledResult<number>).value,
    );
    expect(values).toEqual([2, 4, 6, 8, 10]);
  });

  it("should throw if concurrency is zero", async () => {
    await expect(
      processInChunks([1], 0, (n) => Promise.resolve(n)),
    ).rejects.toThrow("concurrency must be a positive integer");
  });

  it("should throw if concurrency is negative", async () => {
    await expect(
      processInChunks([1], -1, (n) => Promise.resolve(n)),
    ).rejects.toThrow("concurrency must be a positive integer");
  });

  it("should throw if concurrency is not an integer", async () => {
    await expect(
      processInChunks([1], 1.5, (n) => Promise.resolve(n)),
    ).rejects.toThrow("concurrency must be a positive integer");
  });
});
