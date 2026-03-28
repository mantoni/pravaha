import { expect, it } from 'vitest';

import * as pravaha from './pravaha.js';
import { definePlugin } from './define-plugin.js';
import { validateRepo } from './validate-repo.js';

it('re-exports the primary public api surface', () => {
  expect(pravaha.definePlugin).toBe(definePlugin);
  expect(pravaha.validateRepo).toBe(validateRepo);
});
