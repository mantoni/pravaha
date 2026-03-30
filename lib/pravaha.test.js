import { expect, it } from 'vitest';

import { approve as approve_run } from './approve.js';
import { approve, run, runCodex } from './flow/built-ins.js';
import * as pravaha from './pravaha.js';
import { defineFlow } from './flow/flow-contract.js';
import { definePlugin } from './plugins/plugin-contract.js';
import { initQueue } from './queue/queue.js';
import { validateRepo } from './repo/validate-repo.js';

it('re-exports the primary public api surface', () => {
  expect(pravaha.approve).toBe(approve);
  expect(pravaha.approveRun).toBe(approve_run);
  expect(pravaha.defineFlow).toBe(defineFlow);
  expect(pravaha.definePlugin).toBe(definePlugin);
  expect(pravaha.initQueue).toBe(initQueue);
  expect(pravaha.run).toBe(run);
  expect(pravaha.runCodex).toBe(runCodex);
  expect(pravaha.validateRepo).toBe(validateRepo);
});
