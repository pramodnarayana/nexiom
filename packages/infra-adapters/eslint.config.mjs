// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
    {
        ignores: ['eslint.config.mjs', 'dist/**'],
    },
        {
        plugins: {
            "import": importPlugin,
        },
        rules: {
            "import/no-restricted-paths": [
                "error",
                {
                    basePath: __dirname,
                    zones: [
                        {
                            target: "./src",
                            from: "../../engine",
                            message: "Infrastructure packages must not import from the core Sync Engine. Blast radius boundary violated."
                        }
                    ]
                }
            ]
        }
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: __dirname,
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
            '@typescript-eslint/no-unsafe-member-access': 'off',
            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
);
