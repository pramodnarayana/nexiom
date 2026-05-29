import { describe, it, expect } from 'vitest';
import { StubWindmillClient } from './stub-windmill.client.js';

describe('StubWindmillClient', () => {
  it('implements no-op methods and returns expected stub values', async () => {
    const client = new StubWindmillClient();

    await expect(client.ensureConnectionScript()).resolves.toBeUndefined();
    await expect(
      client.createSchedule('stitch-1', '0 0 * * *', true),
    ).resolves.toBeUndefined();
    await expect(
      client.updateSchedule('stitch-1', '0 0 * * *', true),
    ).resolves.toBe(false);
    await expect(
      client.setScheduleEnabled('stitch-1', true),
    ).resolves.toBeUndefined();
    await expect(client.scheduleExists('stitch-1')).resolves.toBe(false);
    await expect(client.deleteSchedule('stitch-1')).resolves.toBeUndefined();
    await expect(client.triggerOnce('stitch-1')).resolves.toBe(
      'stub-job-stitch-1',
    );
  });
});
