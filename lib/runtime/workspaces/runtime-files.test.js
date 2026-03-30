// @module-tag lint-staged-excluded

import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';
import {
  cleanupWorkspace,
  prepareWorkspace,
  readReusableWorkspaceIdentities,
  writeRuntimeRecord,
} from './runtime-files.js';

it('reuses pooled workspaces and cleanup leaves them intact', async () => {
  const temp_directory = await createFixtureRepo();
  const workspace_path = join(temp_directory, '.pravaha/worktrees/app');

  try {
    const first_assignment = await prepareWorkspace(
      temp_directory,
      createPooledWorkspaceDefinition(workspace_path),
    );
    const second_assignment = await prepareWorkspace(
      temp_directory,
      createPooledWorkspaceDefinition(workspace_path),
    );

    expect(second_assignment).toMatchObject({
      identity: workspace_path,
      mode: 'pooled',
      path: first_assignment.path,
      ref: 'main',
      slot: workspace_path,
      workspace_id: 'app',
    });

    await cleanupWorkspace(second_assignment);

    await expect(access(second_assignment.path)).resolves.toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('recreates pooled workspaces after the directory is deleted manually', async () => {
  const temp_directory = await createFixtureRepo();
  const workspace_path = join(temp_directory, '.pravaha/worktrees/app');

  try {
    const first_assignment = await prepareWorkspace(
      temp_directory,
      createPooledWorkspaceDefinition(workspace_path),
    );

    await rm(first_assignment.path, {
      force: true,
      recursive: true,
    });

    const second_assignment = await prepareWorkspace(
      temp_directory,
      createPooledWorkspaceDefinition(workspace_path),
    );

    expect(second_assignment).toMatchObject({
      identity: workspace_path,
      mode: 'pooled',
      path: first_assignment.path,
      ref: 'main',
      slot: workspace_path,
      workspace_id: 'app',
    });
    await expect(access(join(second_assignment.path, '.git'))).resolves.toBe(
      undefined,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('deletes ephemeral workspaces during cleanup', async () => {
  const temp_directory = await createFixtureRepo();
  const workspace_path = join(
    temp_directory,
    '.pravaha/worktrees/implement-runtime-slice',
  );

  try {
    const workspace_assignment = await prepareWorkspace(
      temp_directory,
      createEphemeralWorkspaceDefinition(workspace_path),
    );

    await cleanupWorkspace(workspace_assignment);

    await expect(access(workspace_assignment.path)).rejects.toThrow();
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

it('uses the concrete workspace path as the reusable identity', () => {
  expect(
    readReusableWorkspaceIdentities({
      id: 'app',
      location: {
        path: '/tmp/pravaha/app',
      },
      mode: 'pooled',
      ref: 'main',
      source: {
        kind: 'repo',
      },
    }),
  ).toEqual(['/tmp/pravaha/app']);
});

it('rejects blank configured workspace paths', () => {
  expect(() =>
    readReusableWorkspaceIdentities({
      id: 'app',
      location: {
        path: '   ',
      },
      mode: 'pooled',
      ref: 'main',
      source: {
        kind: 'repo',
      },
    }),
  ).toThrow('Expected workspace.location.path to be a non-empty string.');
});

it('rejects workspaces that omit a concrete location path', () => {
  expect(() =>
    readReusableWorkspaceIdentities(
      /** @type {any} */ ({
        id: 'app',
        mode: 'pooled',
        ref: 'main',
        source: {
          kind: 'repo',
        },
      }),
    ),
  ).toThrow('Expected workspace.location.path to be a non-empty string.');
});

/**
 * @param {string} workspace_path
 * @returns {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'pooled',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }}
 */
function createPooledWorkspaceDefinition(workspace_path) {
  return {
    id: 'app',
    location: {
      path: workspace_path,
    },
    mode: 'pooled',
    ref: 'main',
    source: {
      kind: 'repo',
    },
  };
}

/**
 * @param {string} workspace_path
 * @returns {{
 *   id: string,
 *   location: {
 *     path: string,
 *   },
 *   mode: 'ephemeral',
 *   ref: string,
 *   source: {
 *     kind: 'repo',
 *   },
 * }}
 */
function createEphemeralWorkspaceDefinition(workspace_path) {
  return {
    id: 'app',
    location: {
      path: workspace_path,
    },
    mode: 'ephemeral',
    ref: 'main',
    source: {
      kind: 'repo',
    },
  };
}
