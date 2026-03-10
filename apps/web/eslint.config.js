import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  // ─── Base rules for all TypeScript/TSX files ───────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Enterprise: no silent type escapes
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore': 'allow-with-description',
        'ts-expect-error': 'allow-with-description',
      }],
    },
  },
  // ─── Connections module: ban browser credential storage ───────────────────
  // Rationale: OAuth credentials (clientId, clientSecret, vendorParams) must
  // NEVER be persisted to localStorage/sessionStorage. They are unencrypted
  // plain text readable by any malicious extension or XSS payload.
  // Credentials are encrypted and stored server-side. Use backend endpoints.
  // See: .agents/coder.md §Core Architecture Directives
  {
    files: ['src/modules/connections/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            '[Enterprise Policy] Do not use localStorage in the connections module. ' +
            'OAuth credentials must be stored encrypted on the backend, not in plain-text browser storage. ' +
            'See .agents/coder.md for the enterprise credential persistence pattern.',
        },
        {
          name: 'sessionStorage',
          message:
            '[Enterprise Policy] Do not use sessionStorage in the connections module. ' +
            'OAuth credentials must be stored encrypted on the backend. ' +
            'See .agents/coder.md for the enterprise credential persistence pattern.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='window'][property.name='localStorage']",
          message:
            '[Enterprise Policy] Do not use window.localStorage in the connections module. ' +
            'See .agents/coder.md for the enterprise credential persistence pattern.',
        },
        {
          selector: "MemberExpression[object.name='window'][property.name='sessionStorage']",
          message:
            '[Enterprise Policy] Do not use window.sessionStorage in the connections module. ' +
            'See .agents/coder.md for the enterprise credential persistence pattern.',
        },
        {
          selector: "MemberExpression[object.name='globalThis'][property.name='localStorage']",
          message:
            '[Enterprise Policy] globalThis.localStorage is forbidden in the connections module. ' +
            'See .agents/coder.md for the enterprise credential persistence pattern.',
        },
      ],
    },
  },
])
