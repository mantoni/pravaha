import { defineConfig } from 'vitest/config';

const GLOBAL_SLOW_TEST_THRESHOLD = 5_000;
const INTEGRATION_TEST_TAG = 'integration';
const SMOKE_TEST_TAG = 'smoke';

export default defineConfig({
  test: {
    include: ['**/*.test.js'],
    slowTestThreshold: GLOBAL_SLOW_TEST_THRESHOLD,
    tags: [
      {
        description: 'Integration tests',
        name: INTEGRATION_TEST_TAG,
        timeout: 15_000,
      },
      {
        description: 'Package and workflow smoke tests',
        name: SMOKE_TEST_TAG,
        timeout: 30_000,
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
