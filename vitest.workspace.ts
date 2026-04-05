import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/*/vitest.config.{ts,mts,js}',
  'packages/*/vitest.config.{ts,mts,js}',
  'engine/application/*/vitest.config.{ts,mts,js}',
  'engine/platform/*/vitest.config.{ts,mts,js}'
]);
