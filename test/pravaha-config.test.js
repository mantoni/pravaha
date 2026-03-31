import { expect, it } from 'vitest';

import pravaha_config from '../pravaha.config.js';

it('defines the Pravaha flow config', () => {
  expect(pravaha_config).toMatchObject({
    workspaces: {
      app: {
        mode: 'pooled',
        paths: ['.pravaha/worktrees/abbott', '.pravaha/worktrees/castello'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
    flows: ['flows/implement-task.js'],
  });
});
