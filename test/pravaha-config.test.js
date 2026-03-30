import { expect, it } from 'vitest';

import pravaha_config from '../pravaha.json' with { type: 'json' };

it('defines the Pravaha flow and plugin config', () => {
  expect(pravaha_config).toEqual({
    plugins: {
      dir: 'plugins',
    },
    workspaces: {
      app: {
        paths: ['.pravaha/worktrees/abbott', '.pravaha/worktrees/castello'],
      },
    },
    flows: {
      default_matches: ['docs/flows/implement-task.yaml'],
    },
  });
});
