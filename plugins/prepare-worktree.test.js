import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import prepare_worktree_plugin from './prepare-worktree.js';

it('runs the configured shell command inside the assigned worktree', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-plugin-'));

  try {
    await prepare_worktree_plugin.run({
      with: {
        command: "printf 'ready\\n' > plugin-output.txt",
      },
      worktree_path: temp_directory,
    });

    await expect(
      readFile(join(temp_directory, 'plugin-output.txt'), 'utf8'),
    ).resolves.toBe('ready\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
