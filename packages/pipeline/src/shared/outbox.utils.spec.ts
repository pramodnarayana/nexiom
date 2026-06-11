import { describe, it, expect } from "vitest";
import { processInChunks } from "../shared/outbox.utils.js";

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

  it.each([
    [0, "zero"],
    [-1, "negative"],
    [1.5, "non-integer"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-0.5, "negative non-integer"],
  ])("should throw if concurrency is %s (%s)", async (invalidConcurrency) => {
    await expect(
      processInChunks([1], invalidConcurrency, (n) => Promise.resolve(n)),
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

    // Wait for initial chunk to start (1 tick: processInChunks starts)
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    // Resolve first chunk — needs 2 ticks:
    //   tick 1: individual promise handlers run → allSettled resolves
    //   tick 2: processInChunks resumes and starts chunk 2
    resolvers[0]();
    resolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3, 4]);

    // Resolve second chunk
    resolvers[2]();
    resolvers[3]();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3, 4, 5]);

    // Resolve last task
    resolvers[4]();

    const results = await resultPromise;
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
