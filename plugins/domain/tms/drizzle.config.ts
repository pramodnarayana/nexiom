import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './tms-drizzle.schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
});
