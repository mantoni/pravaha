import { expect, it } from 'vitest';

import * as pravaha from './pravaha.js';
import { definePlugin } from './plugins/plugin-contract.js';
import { initQueue } from './queue/queue.js';
import { validateRepo } from './repo/validate-repo.js';

it('re-exports the primary public api surface', () => {
  expect(pravaha.definePlugin).toBe(definePlugin);
  expect(pravaha.initQueue).toBe(initQueue);
  expect(pravaha.validateRepo).toBe(validateRepo);
});
