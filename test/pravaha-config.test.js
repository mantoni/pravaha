import { expect, it } from 'vitest';

import pravaha_config from '../pravaha.json' with { type: 'json' };

it('defines semantic role and state mappings for Pravaha flows', () => {
  expect(pravaha_config).toEqual({
    semantic_roles: {
      contract: ['contract'],
      decision: ['decision'],
      flow: ['flow'],
      task: ['task'],
    },
    semantic_states: {
      active: ['active'],
      blocked: ['blocked'],
      proposed: ['proposed'],
      ready: ['ready'],
      review: ['review'],
      terminal: ['accepted', 'done', 'dropped', 'superseded'],
    },
  });
});
