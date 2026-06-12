// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/**
 * Returns a Flat Config object establishing an architectural boundary,
 * preventing 'packages/' infrastructure code from importing 'engine/' IP code.
 * @param {string} basePath The package root directory (__dirname)
 */
export function getArchitectureBoundaryRule(basePath) {
    return {
        plugins: {
            "import": importPlugin,
        },
        rules: {
            "import/no-restricted-paths": [
                "error",
                {
                    basePath,
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
    };
}

/**
 * Creates a shared ESLint config for Soopa integration packages.
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
