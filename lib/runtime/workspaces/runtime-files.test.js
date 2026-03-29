// @module-tag lint-staged-excluded
/* eslint-disable max-lines-per-function */

import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';
import {
  cleanupWorkspace,
  prepareWorkspace,
  writeRuntimeRecord,
} from './runtime-files.js';

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

it('recreates pooled workspaces after the directory is deleted manually', async () => {
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

    await rm(first_assignment.path, {
      force: true,
      recursive: true,
    });

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
    await expect(access(join(second_assignment.path, '.git'))).resolves.toBe(
      undefined,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('writes runtime records', async () => {
  const temp_directory = await createFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecord(runtime_record_path, {
      local_outcome: {
        state: 'success',
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"state": "success"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
it('writes runtime records into missing directories', async () => {
  const temp_directory = await createFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/nested/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecord(runtime_record_path, {
      local_outcome: {
        state: 'unresolved',
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"state": "unresolved"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
