// @module-tag lint-staged-excluded
/* eslint-disable max-lines-per-function */

import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createFixtureRepo } from './run-happy-path.fixture-test-helpers.js';
import {
  cleanupWorktree,
  cleanupWorkspace,
  prepareWorktree,
  prepareWorkspace,
  updateDocumentStatus,
  writeRuntimeRecord,
} from './runtime-files.js';

it('creates and then removes ephemeral worktrees', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const worktree_assignment = await prepareWorktree(
      temp_directory,
      'implement-runtime-slice',
      {
        mode: 'ephemeral',
      },
      '2026-03-25T12:00:00.000Z',
    );

    await expect(
      access(join(worktree_assignment.path, '.git')),
    ).resolves.toBeUndefined();

    await cleanupWorktree(worktree_assignment);

    await expect(access(worktree_assignment.path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reuses named worktrees and cleanup leaves them intact', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const first_assignment = await prepareWorktree(
      temp_directory,
      'implement-runtime-slice',
      {
        mode: 'named',
        slot: 'castello',
      },
      '2026-03-25T12:00:00.000Z',
    );
    const second_assignment = await prepareWorktree(
      temp_directory,
      'another-task',
      {
        mode: 'named',
        slot: 'castello',
      },
      '2026-03-25T12:30:00.000Z',
    );

    expect(second_assignment).toMatchObject({
      identity: 'castello',
      mode: 'named',
      path: first_assignment.path,
      slot: 'castello',
    });

    await cleanupWorktree(second_assignment);

    await expect(access(second_assignment.path)).resolves.toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reuses pooled workspaces and cleanup leaves them intact', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const first_assignment = await prepareWorkspace(
      temp_directory,
      'implement-runtime-slice',
      {
        materialize: {
          kind: 'worktree',
          mode: 'pooled',
          ref: 'main',
        },
        source: {
          id: 'app',
          kind: 'repo',
        },
        type: 'git.workspace',
      },
      '2026-03-25T12:00:00.000Z',
    );
    const second_assignment = await prepareWorkspace(
      temp_directory,
      'another-task',
      {
        materialize: {
          kind: 'worktree',
          mode: 'pooled',
          ref: 'main',
        },
        source: {
          id: 'app',
          kind: 'repo',
        },
        type: 'git.workspace',
      },
      '2026-03-25T12:30:00.000Z',
    );

    expect(second_assignment).toMatchObject({
      identity: 'pooled-app-main',
      mode: 'pooled',
      path: first_assignment.path,
      ref: 'main',
      source_id: 'app',
    });

    await cleanupWorkspace(second_assignment);

    await expect(access(second_assignment.path)).resolves.toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('writes runtime records and updates document status', async () => {
  const temp_directory = await createFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const task_path = join(
    temp_directory,
    'docs/tasks/runtime/implement-runtime-slice.md',
  );

  try {
    await writeRuntimeRecord(runtime_record_path, {
      local_outcome: {
        state: 'success',
      },
    });
    await updateDocumentStatus(task_path, 'ready', 'review');

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"state": "success"',
    );
    await expect(readFile(task_path, 'utf8')).resolves.toContain(
      'Status: review',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects document status updates when metadata is missing or stale', async () => {
  const temp_directory = await createFixtureRepo();
  const missing_status_path = join(
    temp_directory,
    'docs/tasks/runtime/no-status.md',
  );

  try {
    await writeFile(missing_status_path, '# No Status\n');

    await expect(
      updateDocumentStatus(missing_status_path, 'ready', 'review'),
    ).rejects.toThrow(`Missing Status field in ${missing_status_path}.`);
    await expect(
      updateDocumentStatus(
        join(temp_directory, 'docs/tasks/runtime/implement-runtime-slice.md'),
        'blocked',
        'review',
      ),
    ).rejects.toThrow('to be blocked, found ready');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('writes runtime records into missing directories and keeps named cleanup idempotent', async () => {
  const temp_directory = await createFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/nested/implement-runtime-slice.json',
  );

  try {
    const worktree_assignment = await prepareWorktree(
      temp_directory,
      'implement-runtime-slice',
      {
        mode: 'named',
        slot: 'castello',
      },
      '2026-03-25T12:00:00.000Z',
    );

    await cleanupWorktree(worktree_assignment);
    await writeRuntimeRecord(runtime_record_path, {
      local_outcome: {
        state: 'unresolved',
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"state": "unresolved"',
    );
    await expect(access(worktree_assignment.path)).resolves.toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('lowercases ephemeral worktree identity tokens derived from lease timestamps', async () => {
  const temp_directory = await createFixtureRepo();

  try {
    const worktree_assignment = await prepareWorktree(
      temp_directory,
      'implement-runtime-slice',
      {
        mode: 'ephemeral',
      },
      '2026-03-25T12:00:00.000Z',
    );

    expect(worktree_assignment.identity).toBe(
      'ephemeral-implement-runtime-slice-2026-03-25t12-00-00-000z',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
