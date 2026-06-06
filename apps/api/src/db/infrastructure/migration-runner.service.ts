import { Injectable } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

@Injectable()
export class MigrationRunnerService {
  constructor() {}

  async migrateAllSchemas(): Promise<void> {
    console.log('🔄 Running Drizzle migrations...');

    const __filename = fileURLToPath(import.meta.url);
    const dbDir = path.dirname(path.dirname(__filename));

    try {
      await execAsync('npx drizzle-kit migrate', {
        cwd: dbDir,
        env: {
          ...process.env,
        },
        timeout: 300000,
      });
      console.log('✅ Base migrations completed successfully');
    } catch (error) {
      console.error('❌ Base migrations failed:', error);
      throw error;
    }
  }

  async migrateTenant(dbName: string, hostUrl: string): Promise<void> {
    console.log(`🔄 Running migrations for tenant DB: ${dbName}`);

    const __filename = fileURLToPath(import.meta.url);
    const dbDir = path.dirname(path.dirname(__filename));

    try {
      // Construct a proper database URL using the URL API
      const url = new URL(hostUrl);
      // Normalize pathname: remove trailing slash if present
      let pathname = url.pathname.replace(/\/$/, '');
      // Append the encoded database name as a path segment
      pathname = pathname + '/' + encodeURIComponent(dbName);
      url.pathname = pathname;
      const urlWithDb = url.toString();

      await execAsync('npx drizzle-kit migrate', {
        cwd: dbDir,
        env: {
          ...process.env,
          DATABASE_URL: urlWithDb,
        },
        timeout: 300000,
      });

      console.log(`✅ Tenant migrations completed successfully for ${dbName}`);
    } catch (error) {
      console.error(`❌ Tenant migrations failed for ${dbName}:`, error);
      throw error;
    }
  }
}
