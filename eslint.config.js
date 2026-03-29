/** @import { Linter } from 'eslint'; */

import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

/** @type {Linter.RulesRecord} */
const COMMON_JS_RULES = {
  complexity: ['error', { max: 10 }],
  'max-depth': ['warn', { max: 3 }],
  'max-lines': [
    'error',
    {
      max: 275,
      skipBlankLines: true,
      skipComments: false,
    },
  ],
  'max-lines-per-function': [
    'error',
    {
      max: 60,
      skipBlankLines: true,
      skipComments: false,
      IIFEs: true,
    },
  ],
  'no-console': 'off',
  'no-restricted-imports': ['error', {}],
  'no-useless-catch': 'error',
  'no-warning-comments': [
    'warn',
    {
      location: 'anywhere',
      terms: ['todo', 'fixme', 'xxx'],
    },
  ],
};

/** @type {Linter.RulesRecord} */
const JSDOC_RULES = {
  'jsdoc/check-param-names': 'error',
  'jsdoc/check-tag-names': ['error', { definedTags: ['patram'] }],
  'jsdoc/check-types': 'error',
  'jsdoc/prefer-import-tag': 'error',
  'jsdoc/require-jsdoc': 'off',
  'jsdoc/require-param': 'warn',
  'jsdoc/require-param-name': 'warn',
  'jsdoc/require-param-type': 'warn',
};

/** @type {Linter.RulesRecord} */
const COMMON_TYPESCRIPT_ESLINT_RULES = {
  '@typescript-eslint/naming-convention': [
    'error',
    {
      selector: 'variable',
      types: ['function'],
      format: ['camelCase'],
    },
    {
      selector: 'function',
      format: ['camelCase'],
    },
    {
      selector: 'variable',
      format: ['snake_case', 'UPPER_CASE'],
    },
  ],
};

const TEST_GLOBALS = {
  ...globals.browser,
  ...globals.node,
  ...globals.vitest,
};

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/node_modules/**', '**/.pravaha/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.js', '**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      sourceType: 'module',
    },
    plugins: {
      jsdoc,
    },
    rules: {
      ...COMMON_JS_RULES,
      ...JSDOC_RULES,
      ...COMMON_TYPESCRIPT_ESLINT_RULES,
    },
  },
  {
    files: ['app/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['bin/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: TEST_GLOBALS,
    },
    rules: {
      'max-lines': [
        'error',
        {
          max: 500,
          skipBlankLines: true,
          skipComments: false,
        },
      ],
      'max-lines-per-function': [
        'error',
        {
          max: 45,
          skipBlankLines: true,
          skipComments: false,
          IIFEs: true,
        },
      ],
    },
  },
);
