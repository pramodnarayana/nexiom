import { CommandFactory } from 'nest-commander';
import { DatabaseCliModule } from './cli.module.js';

async function bootstrap() {
  await CommandFactory.run(DatabaseCliModule, ['warn', 'error']);
}

bootstrap().catch((err) => {
  console.error('Fatal Error during database CLI execution:', err);
  process.exit(1);
});
