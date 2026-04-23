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

  it("should respect concurrency limit and process in chunks", async () => {
    const started: number[] = [];
    const resolvers: Array<() => void> = [];

    const taskFn = (n: number): Promise<number> => {
      return new Promise<number>((resolve) => {
        started.push(n);
        resolvers.push(() => resolve(n * 2));
      });
    };

    const resultPromise = processInChunks([1, 2, 3, 4, 5], 2, taskFn);

    // Wait for initial chunk to start
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([1, 2]);

    // Resolve first chunk
    resolvers[0]();
    resolvers[1]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([1, 2, 3, 4]);

    // Resolve second chunk
    resolvers[2]();
    resolvers[3]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([1, 2, 3, 4, 5]);

    // Resolve last task
    resolvers[4]();

    const results = await resultPromise;
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});