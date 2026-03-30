/**
 * Processes `items` in sequential chunks of `concurrency` size.
 * Prevents unbounded parallelism (DB pool exhaustion) at both the
 * workspace-drain level and the per-row publish level in the outbox workers.
 */
export async function processInChunks<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}
