import { expect, it } from 'vitest';

import { defineConfig } from './config.js';
import { defineConfig as define_config_from_contract } from './config/config-contract.js';

it('re-exports the config authoring api from the config entry point', () => {
  expect(defineConfig).toBe(define_config_from_contract);
});
