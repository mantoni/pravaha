import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

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

const JSDOC_RULES = {
  'jsdoc/check-param-names': 'error',
  'jsdoc/check-tag-names': 'error',
  'jsdoc/check-types': 'error',
  'jsdoc/prefer-import-tag': 'error',
  'jsdoc/require-jsdoc': [
    'warn',
    {
      enableFixer: false,
      require: {
        ArrowFunctionExpression: false,
        ClassDeclaration: false,
        ClassExpression: false,
        FunctionDeclaration: true,
        FunctionExpression: false,
        MethodDefinition: true,
      },
    },
  ],
  'jsdoc/require-param': 'warn',
  'jsdoc/require-param-name': 'warn',
  'jsdoc/require-param-type': 'warn',
};

const TEST_GLOBALS = {
  ...globals.browser,
  ...globals.node,
  ...globals.vitest,
};

export default [
  {
    ignores: ['**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: {
      jsdoc,
    },
    rules: {
      ...COMMON_JS_RULES,
      ...JSDOC_RULES,
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
];
