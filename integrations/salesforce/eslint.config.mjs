// @ts-check
import { createIntegrationConfig } from '@nexiom/eslint-config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default createIntegrationConfig(__dirname);
