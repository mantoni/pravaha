import { defineConfig } from './lib/pravaha.js';

export default defineConfig({
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
