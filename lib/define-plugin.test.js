import { expect, it } from 'vitest';

import { definePlugin as exported_define_plugin } from './define-plugin.js';
import { definePlugin as contract_define_plugin } from './plugin-contract.js';

it('re-exports the plugin contract helper', () => {
  expect(exported_define_plugin).toBe(contract_define_plugin);
});
