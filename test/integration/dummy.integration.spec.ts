import { describe, it, expect } from 'vitest';
import pg from 'pg';

describe('Integration Test Setup', () => {
  it('connects to testcontainers postgres', async () => {
    const { Client } = pg;
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
    });
    
    await client.connect();
    const res = await client.query('SELECT 1 as result');
    await client.end();
    
    expect(res.rows[0].result).toBe(1);
  });
});
