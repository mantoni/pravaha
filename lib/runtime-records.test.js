/* eslint-disable max-lines-per-function */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import {
  listUnresolvedRuntimeRecords,
  loadSingleUnresolvedStateMachineRuntimeRecord,
} from './runtime-records.js';

it('returns no unresolved runtime records when the runtime directory is missing', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-empty-');

  try {
    await expect(listUnresolvedRuntimeRecords(repo_directory)).resolves.toEqual(
      [],
    );
    await expect(
      loadSingleUnresolvedStateMachineRuntimeRecord(repo_directory),
    ).rejects.toThrow('No unresolved runtime record is available.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('lists only unresolved runtime records and sorts them by path', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-list-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'zeta.json'),
      createRecordFixture({
        local_outcome_state: 'success',
        task_id: 'zeta-task',
      }),
    );
    await writeRuntimeRecord(
      join(runtime_directory, 'beta.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'beta-task',
      }),
    );
    await writeRuntimeRecord(join(runtime_directory, 'alpha.json'), {
      contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
      execution: {
        run_id: 'run:alpha-task',
      },
      flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
      format_version: 'state-machine-v2',
      lease: {
        leased_at: '2026-03-25T12:00:00.000Z',
      },
      local_outcome: {
        state: 'unresolved',
      },
      prompt: 'Persisted prompt.',
      selected_task: {
        id: 'alpha-task',
        path: 'docs/tasks/runtime/alpha-task.md',
      },
      worker: {
        error_message: null,
        final_response: null,
        item_count: 0,
        thread_id: 'thread-runtime',
        usage: null,
      },
      worktree: {
        path: '/repo/.pravaha/worktrees/alpha-task',
      },
    });

    const unresolved_runtime_records =
      await listUnresolvedRuntimeRecords(repo_directory);

    expect(
      unresolved_runtime_records.map((runtime_record) => runtime_record.record),
    ).toMatchObject([
      {
        selected_task: {
          id: 'alpha-task',
        },
      },
      {
        selected_task: {
          id: 'beta-task',
        },
      },
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails closed when more than one unresolved runtime record exists', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-multi-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      join(runtime_directory, 'first.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'first-task',
      }),
    );
    await writeRuntimeRecord(
      join(runtime_directory, 'second.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'second-task',
      }),
    );

    await expect(
      loadSingleUnresolvedStateMachineRuntimeRecord(repo_directory),
    ).rejects.toThrow(
      'Expected exactly one unresolved runtime record, found 2.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('loads the only unresolved runtime record for the state-machine engine', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-single-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const runtime_record_path = join(runtime_directory, 'resume.json');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      runtime_record_path,
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'resume-task',
      }),
    );

    await expect(
      loadSingleUnresolvedStateMachineRuntimeRecord(repo_directory),
    ).resolves.toEqual({
      record: createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'resume-task',
      }),
      runtime_record_path,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects legacy unresolved runtime records for the state-machine engine', async () => {
  const repo_directory = await mkdirTempRepo(
    'runtime-records-legacy-state-machine-',
  );
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const runtime_record_path = join(runtime_directory, 'resume.json');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(
      runtime_record_path,
      createLegacyRecordFixture('resume-task'),
    );

    await expect(
      loadSingleUnresolvedStateMachineRuntimeRecord(repo_directory),
    ).rejects.toThrow('Clear local runtime state before continuing.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('loads a state-machine unresolved runtime record when the format marker is present', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-state-machine-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');
  const runtime_record_path = join(runtime_directory, 'resume.json');
  const runtime_record = {
    ...createRecordFixture({
      local_outcome_state: 'unresolved',
      task_id: 'resume-task',
    }),
    format_version: 'state-machine-v2',
    job_state: {
      current_job_name: 'implement',
    },
  };

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeRuntimeRecord(runtime_record_path, runtime_record);

    await expect(
      loadSingleUnresolvedStateMachineRuntimeRecord(repo_directory),
    ).resolves.toEqual({
      record: runtime_record,
      runtime_record_path,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('ignores non-json entries and terminal failures', async () => {
  const repo_directory = await mkdirTempRepo('runtime-records-filter-');
  const runtime_directory = join(repo_directory, '.pravaha/runtime');

  try {
    await mkdir(runtime_directory, { recursive: true });
    await writeFile(join(runtime_directory, 'notes.txt'), 'skip\n');
    await writeRuntimeRecord(
      join(runtime_directory, 'failed.json'),
      createRecordFixture({
        local_outcome_state: 'success',
        task_id: 'failed-task',
      }),
    );
    await writeRuntimeRecord(
      join(runtime_directory, 'pending.json'),
      createRecordFixture({
        local_outcome_state: 'unresolved',
        task_id: 'pending-task',
      }),
    );

    await expect(
      listUnresolvedRuntimeRecords(repo_directory),
    ).resolves.toMatchObject([
      {
        record: {
          selected_task: {
            id: 'pending-task',
          },
        },
        runtime_record_path: join(runtime_directory, 'pending.json'),
      },
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rethrows non-missing runtime directory errors', async () => {
  const file_backed_repo = await mkdirTempRepo('runtime-records-enotdir-');

  try {
    await writeFile(join(file_backed_repo, '.pravaha'), 'not a directory\n');

    await expect(
      listUnresolvedRuntimeRecords(file_backed_repo),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'ENOTDIR',
      }),
    );
  } finally {
    await rm(file_backed_repo, { force: true, recursive: true });
  }
});

/**
 * @param {string} prefix
 * @returns {Promise<string>}
 */
async function mkdirTempRepo(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * @param {{
 *   local_outcome_state: 'success' | 'unresolved',
 *   task_id: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRecordFixture(options) {
  return {
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    execution: {
      run_id: `run:${options.task_id}`,
    },
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    format_version: 'state-machine-v2',
    job_state: {
      current_job_name: 'implement',
      job_outputs: {},
      job_visit_counts: {
        implement: 1,
      },
    },
    lease: {
      leased_at: '2026-03-25T12:00:00.000Z',
    },
    local_outcome: {
      state: options.local_outcome_state,
    },
    prompt: 'Persisted prompt.',
    selected_task: {
      id: options.task_id,
      path: `docs/tasks/runtime/${options.task_id}.md`,
    },
    worker: {
      error_message: null,
      final_response: null,
      item_count: 0,
      thread_id: 'thread-runtime',
      usage: null,
    },
    worktree: {
      path: `/repo/.pravaha/worktrees/${options.task_id}`,
    },
  };
}

/**
 * @param {string} task_id
 * @returns {Record<string, unknown>}
 */
function createLegacyRecordFixture(task_id) {
  return {
    contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    lease: {
      leased_at: '2026-03-25T12:00:00.000Z',
    },
    local_outcome: {
      state: 'unresolved',
    },
    prompt: 'Persisted prompt.',
    selected_task: {
      id: task_id,
      path: `docs/tasks/runtime/${task_id}.md`,
    },
    worker: {
      error_message: null,
      final_response: null,
      item_count: 0,
      thread_id: 'thread-runtime',
      usage: null,
    },
    worktree: {
      path: `/repo/.pravaha/worktrees/${task_id}`,
    },
  };
}

/**
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecord(runtime_record_path, runtime_record) {
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}
