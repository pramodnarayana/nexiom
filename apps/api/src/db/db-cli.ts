/* istanbul ignore file */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables — root .env first (no override), then API-specific
// .env second (also no override) so existing shell/CI vars always take precedence
// over checked-in .env files. This prevents destructive commands (drop/fresh/reset)
// from being redirected by local .env values when running in CI.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

import { DatabaseManager } from './database-manager.js';

const COMMANDS = [
  'drop',
  'migrate',
  'seed',
  'fresh',
  'reset',
  'check-user',
  'check-role',
  'seed:abac',
] as const;
type Command = (typeof COMMANDS)[number];

async function main() {
  const command = process.argv[2] as Command;

  if (!command || !COMMANDS.includes(command)) {
    console.error('Usage: tsx db-cli.ts <command>');
    console.error('Commands:');
    for (const cmd of COMMANDS) console.error(`  ${cmd}`);
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL || '';
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':***@');
  console.log(`🔌 Database: ${maskedUrl}`);

  const manager = new DatabaseManager();

  try {
    switch (command) {
      case 'drop':
        await manager.dropAll();
        break;
      case 'migrate':
        manager.migrate();
        break;
      case 'seed':
        await manager.seed();
        break;
      case 'fresh':
        await manager.fresh();
        break;
      case 'reset':
        await manager.reset();
        break;
      case 'check-user': {
        const identifier = process.argv[3];
        if (!identifier) {
          console.error('Usage: check-user <userId | email>');
          process.exit(1);
        }
        await manager.checkUserPermissions(identifier);
        break;
      }
      case 'check-role': {
        const roleName = process.argv[3];
        if (!roleName) {
          console.error('Usage: check-role <roleName>');
          process.exit(1);
        }
        await manager.debugPermissions(roleName);
        break;
      }
      case 'seed:abac':
        await manager.seedAbac();
        break;
    }
  } catch (error) {
    console.error(
      '\n❌ Error:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

void main();
