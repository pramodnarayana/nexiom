// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // ─── Boundaries plugin ───────────────────────────────────────────────────────
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        {
          type: "module",
          pattern: "src/modules/*",
          mode: "folder"
        }
      ],
      "boundaries/ignore": ["**/*.spec.ts"]
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "allow", // Allow imports by default except for explicit boundaries rules
          rules: [
            {
              from: ["module"],
              disallow: ["module"],
              message: "Strict Module Boundaries Enforcement: A module cannot deep-import from another module. Please communicate via interfaces, ports, or domain events."
            }
          ]
        }
      ]
    }
  },
  // ─── Test files: relax strict typing ─────────────────────────────────────────
  // Rationale: Test stubs and mocks frequently use `any` to avoid excessive
  // boilerplate when mocking complex objects.
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
