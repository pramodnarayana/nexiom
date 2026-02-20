// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Creates a shared ESLint config for Nexiom integration packages.
 * @param {string} tsconfigRootDir - The __dirname of the consuming package
 * @param {object} [overrides] - Optional per-package rule overrides
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function createIntegrationConfig(tsconfigRootDir, overrides = {}) {
    return tseslint.config(
        {
            ignores: ['eslint.config.mjs', 'dist/**'],
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
                    tsconfigRootDir,
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
                        caughtErrorsIgnorePattern: '^_',
                    },
                ],
                '@typescript-eslint/no-floating-promises': 'warn',
                '@typescript-eslint/no-unsafe-argument': 'warn',
                'prettier/prettier': ['error', { endOfLine: 'auto' }],
                ...overrides,
            },
        },
    );
}
