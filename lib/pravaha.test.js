import { expect, it } from 'vitest';

import * as pravaha from './pravaha.js';
import { definePlugin } from './define-plugin.js';
import { reconcile } from './reconcile.js';
import { resume } from './resume.js';
import { validateRepo } from './validate-repo.js';

it('re-exports the primary public api surface', () => {
  expect(pravaha.definePlugin).toBe(definePlugin);
  expect(pravaha.reconcile).toBe(reconcile);
  expect(pravaha.resume).toBe(resume);
  expect(pravaha.validateRepo).toBe(validateRepo);
});
