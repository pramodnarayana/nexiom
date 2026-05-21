import { describe, it, expect } from 'vitest';
import { StubSyncRunner } from './stub-sync-runner.js';

describe('StubSyncRunner', () => {
  it('returns a successful SyncResult immediately', async () => {
    const runner = new StubSyncRunner();
    const result = await runner.run('stitch-123');

    expect(result).toEqual({
      stitchId: 'stitch-123',
      status: 'succeeded',
    });
  });
});
