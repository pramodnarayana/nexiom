import { describe, it, expect } from 'vitest';
import { SyncRunner, type SyncResult } from './sync-runner.js';

class MockSyncRunner extends SyncRunner {
  run(stitchId: string): Promise<SyncResult> {
    return Promise.resolve({
      stitchId,
      status: 'succeeded',
    });
  }
}

describe('SyncRunner', () => {
  it('can be extended and methods implemented', async () => {
    const runner = new MockSyncRunner();
    const result = await runner.run('stitch-123');

    expect(result).toEqual({
      stitchId: 'stitch-123',
      status: 'succeeded',
    });
  });
});
