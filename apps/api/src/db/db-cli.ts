/* istanbul ignore file */
import * as dotenv from 'dotenv';
import * as path from 'node:path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { DatabaseManager } from './database-manager';

const COMMANDS = [
  'drop',
  'migrate',
  'seed',
  'fresh',
  'reset',
  'check-user',
] as const;
type Command = (typeof COMMANDS)[number];

async function main() {
  const command = process.argv[2] as Command;

  if (!command || !COMMANDS.includes(command)) {
    console.error('Usage: tsx db-cli.ts <command>');
    console.error('Commands:');
    console.error('  drop        - Drop all schemas (destructive)');
    console.error('  migrate     - Run pending migrations');
    console.error('  seed        - Seed database with initial data');
    console.error('  fresh       - Drop + Migrate + Seed (complete rebuild)');
    console.error('  reset       - Truncate + Seed (preserve schema)');
    console.error('  check-user  - Debug permissions for a user (email or ID)');
    process.exit(1);
  }

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
