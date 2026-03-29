/* eslint-disable max-lines-per-function */
import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  cleanupStateMachineAttemptContext,
  createStateMachineAttemptContext,
  createStateMachineResumeAttemptContext,
  writeFinalRuntimeRecord,
  writeUnresolvedRuntimeRecord,
} from './runtime-attempt-records.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const FLOW_PATH = 'docs/flows/runtime/single-task-flow-reconciler.yaml';
const TASK_ID = 'implement-runtime-slice';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

it('creates a state-machine attempt context with a prepared pooled workspace', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(
      repo_directory,
      'pooled',
    );

    expect(attempt_context.current_job_name).toBe('implement');
    expect(attempt_context.run_id).toBe(
      'run:implement-runtime-slice:2026-03-27T10:00:00.000Z',
    );
    expect(attempt_context.worktree_assignment.mode).toBe('pooled');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('creates a state-machine resume attempt context from the recorded runtime fields', () => {
  const attempt_context = createStateMachineResumeAttemptContext(
    '/repo',
    createRuntimeRecord(createRecordedRuntimeRecordOptions()),
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.current_job_name).toBe('review');
  expect(attempt_context.job_outputs).toEqual({
    implement: {
      outcome: 'success',
    },
  });
  expect(attempt_context.run_id).toBe('run:demo');
  expect(attempt_context.task_path).toBe('docs/tasks/runtime/demo.md');
});

it('rejects legacy resume records for the state-machine engine', () => {
  expect(() =>
    createStateMachineResumeAttemptContext(
      '/repo',
      {
        contract_path: CONTRACT_PATH,
      },
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Legacy unresolved runtime record /repo/.pravaha/runtime/demo.json is incompatible with the job state-machine engine. Clear local runtime state before continuing.',
  );
});

it('rejects resume records that are missing binding targets', () => {
  expect(() =>
    createStateMachineResumeAttemptContext(
      '/repo',
      createRuntimeRecord({
        ...createRecordedRuntimeRecordOptions(),
        binding_targets: {
          task: /** @type {any} */ ('broken'),
        },
      }),
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Expected /repo/.pravaha/runtime/demo.json to record binding targets.',
  );
});

it('rejects resume records that omit a required current job name', () => {
  expect(() =>
    createStateMachineResumeAttemptContext(
      '/repo',
      createRuntimeRecord({
        ...createRecordedRuntimeRecordOptions(),
        current_job_name: undefined,
      }),
      '/repo/.pravaha/runtime/demo.json',
    ),
  ).toThrow(
    'Expected /repo/.pravaha/runtime/demo.json to record a current job name.',
  );
});

it('writes state-machine runtime records without legacy step fields', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);
    const unresolved_record = await writeUnresolvedRuntimeRecord(
      createRuntimeRecordContext(attempt_context, 'implement', {
        implement: 1,
      }),
      attempt_context,
      null,
    );
    const final_record = await writeFinalRuntimeRecord(
      createRuntimeRecordContext(
        attempt_context,
        'done',
        {
          implement: 1,
          done: 1,
        },
        {
          implement: {
            outcome: 'success',
          },
        },
      ),
      {
        ...attempt_context,
        current_job_name: 'done',
      },
      {
        outcome: 'success',
        worker_error: null,
        worker_final_response: '{"summary":"done"}',
        worker_item_count: 1,
        worker_thread_id: 'thread-1',
        worker_usage: null,
      },
      () => new Date('2026-03-27T10:05:00.000Z'),
    );

    expect(unresolved_record).not.toHaveProperty('steps');
    expect(unresolved_record).not.toHaveProperty('await_query');
    expect(unresolved_record).not.toHaveProperty('lease');
    expect(unresolved_record).not.toHaveProperty('worker');
    expect(unresolved_record).not.toHaveProperty('worktree');
    expect(final_record).not.toHaveProperty('transition_targets');
    expect(final_record.execution).toEqual({
      run_id: attempt_context.run_id,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('prefers explicit runtime record fields when writing unresolved and final records', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);
    const override_attempt_context = {
      ...attempt_context,
      job_outputs: {
        local: {
          outcome: 'failure',
        },
      },
      job_visit_counts: {
        local: 2,
      },
      run_id: 'run:local',
    };
    const unresolved_context = {
      ...createRuntimeRecordContext(
        override_attempt_context,
        'review',
        {
          review: 3,
        },
        {
          review: {
            outcome: 'success',
          },
        },
      ),
      run_id: 'run:override',
    };
    const final_context = {
      ...createRuntimeRecordContext(
        override_attempt_context,
        'done',
        {
          done: 1,
        },
        {
          done: {
            outcome: 'success',
          },
        },
      ),
      run_id: 'run:override',
    };
    const unresolved_record = await writeUnresolvedRuntimeRecord(
      unresolved_context,
      override_attempt_context,
      'thread-1',
    );
    const final_record = await writeFinalRuntimeRecord(
      final_context,
      override_attempt_context,
      {
        outcome: 'success',
        worker_error: null,
        worker_final_response: '{"summary":"done"}',
        worker_item_count: 1,
        worker_thread_id: 'thread-1',
        worker_usage: null,
      },
      () => new Date('2026-03-27T10:05:00.000Z'),
    );

    expect(unresolved_record.execution).toEqual({
      run_id: 'run:override',
    });
    expect(unresolved_record.job_state).toMatchObject({
      current_job_name: 'review',
      job_outputs: {
        review: {
          outcome: 'success',
        },
      },
      job_visit_counts: {
        review: 3,
      },
    });
    expect(final_record.local_outcome).toMatchObject({
      completed_at: '2026-03-27T10:05:00.000Z',
      state: 'success',
    });
    expect(final_record).not.toHaveProperty('worker');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('falls back to attempt-context fields when runtime-record overrides are absent', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);
    const fallback_attempt_context = {
      ...attempt_context,
      current_job_name: 'implement',
      job_outputs: {
        implement: {
          outcome: 'success',
        },
      },
      job_visit_counts: {
        implement: 1,
      },
      run_id: 'run:fallback',
    };
    const unresolved_record = await writeUnresolvedRuntimeRecord(
      {
        binding_targets: {
          task: {
            id: `task:${TASK_ID}`,
            path: TASK_PATH,
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        task_id: TASK_ID,
        task_path: TASK_PATH,
      },
      fallback_attempt_context,
      null,
    );
    const formatless_record = await writeFinalRuntimeRecord(
      {
        binding_targets: {
          task: {
            id: `task:${TASK_ID}`,
            path: TASK_PATH,
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        task_id: TASK_ID,
        task_path: TASK_PATH,
      },
      {
        ...fallback_attempt_context,
        current_job_name: undefined,
      },
      {
        outcome: 'failure',
        worker_error: 'boom',
        worker_final_response: null,
        worker_item_count: 0,
        worker_thread_id: null,
        worker_usage: null,
      },
      () => new Date('2026-03-27T10:05:00.000Z'),
    );

    expect(unresolved_record.execution).toEqual({
      run_id: 'run:fallback',
    });
    expect(unresolved_record.format_version).toBe('state-machine-v2');
    expect(unresolved_record.job_state).toMatchObject({
      current_job_name: 'implement',
      job_outputs: {
        implement: {
          outcome: 'success',
        },
      },
      job_visit_counts: {
        implement: 1,
      },
    });
    expect(formatless_record.format_version).toBeUndefined();
    expect(formatless_record.execution).toEqual({
      run_id: 'run:fallback',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('cleans up ephemeral workspaces after state-machine attempts', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(repo_directory);

    await cleanupStateMachineAttemptContext(attempt_context);

    expect(attempt_context.worktree_assignment.mode).toBe('ephemeral');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('keeps named workspaces in place after state-machine attempts', async () => {
  await expect(
    cleanupStateMachineAttemptContext({
      prompt: 'Prompt',
      runtime_record_path: '/repo/.pravaha/runtime/demo.json',
      worktree_assignment: {
        identity: 'named-workspace',
        mode: 'named',
        path: '/repo/.pravaha/workspaces/named-workspace',
      },
      worktree_path: '/repo/.pravaha/workspaces/named-workspace',
    }),
  ).resolves.toBeUndefined();
});

it('keeps pooled workspaces in place after state-machine attempts', async () => {
  const repo_directory = await createFixtureRepo();

  try {
    const attempt_context = await createAttemptContext(
      repo_directory,
      'pooled',
    );

    await expect(
      cleanupStateMachineAttemptContext(attempt_context),
    ).resolves.toBeUndefined();
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('normalizes absolute binding target paths when resuming state-machine records', () => {
  const attempt_context = createStateMachineResumeAttemptContext(
    '/repo',
    createRuntimeRecord({
      ...createRecordedRuntimeRecordOptions(),
      binding_targets: {
        task: {
          id: 'task:demo',
          path: '/repo/docs/tasks/runtime/demo.md',
          status: 'ready',
        },
      },
    }),
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.binding_targets).toEqual({
    task: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
});

it('skips undefined binding targets when normalizing resume records', () => {
  const runtime_record = createRuntimeRecord(
    createRecordedRuntimeRecordOptions(),
  );

  runtime_record.binding_targets = {
    skipped: undefined,
    task: {
      id: 'task:demo',
      path: '/repo/docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  };

  const attempt_context = createStateMachineResumeAttemptContext(
    '/repo',
    runtime_record,
    '/repo/.pravaha/runtime/demo.json',
  );

  expect(attempt_context.binding_targets).toEqual({
    task: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
});

/**
 * @param {string} repo_directory
 * @param {'ephemeral' | 'pooled'} [mode]
 * @returns {Promise<Awaited<ReturnType<typeof createStateMachineAttemptContext>>>}
 */
function createAttemptContext(repo_directory, mode = 'ephemeral') {
  return createStateMachineAttemptContext(
    repo_directory,
    {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'Runtime slice',
      start_job_name: 'implement',
      task_id: TASK_ID,
      task_path: TASK_PATH,
      workspace: {
        type: 'git.workspace',
        source: {
          id: 'app',
          kind: 'repo',
        },
        materialize: {
          kind: 'worktree',
          mode,
          ref: 'main',
        },
      },
    },
    () => new Date('2026-03-27T10:00:00.000Z'),
  );
}

/**
 * @returns {Parameters<typeof createRuntimeRecord>[0]}
 */
function createRecordedRuntimeRecordOptions() {
  return {
    binding_targets: {
      task: {
        id: 'task:demo',
        path: 'docs/tasks/runtime/demo.md',
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_job_name: 'review',
    flow_path: FLOW_PATH,
    format_version: 'state-machine-v2',
    job_outputs: {
      implement: {
        outcome: 'success',
      },
    },
    job_visit_counts: {
      implement: 1,
    },
    outcome: null,
    run_id: 'run:demo',
    task_id: 'demo',
    task_path: 'docs/tasks/runtime/demo.md',
  };
}

/**
 * @param {Awaited<ReturnType<typeof createStateMachineAttemptContext>> & {
 *   current_job_name?: string,
 *   job_outputs?: Record<string, Record<string, unknown>>,
 *   job_visit_counts?: Record<string, number>,
 *   run_id?: string,
 * }} attempt_context
 * @param {string} current_job_name
 * @param {Record<string, number>} job_visit_counts
 * @param {Record<string, Record<string, unknown>>} [job_outputs]
 * @returns {Parameters<typeof writeUnresolvedRuntimeRecord>[0]}
 */
function createRuntimeRecordContext(
  attempt_context,
  current_job_name,
  job_visit_counts,
  job_outputs = {},
) {
  return {
    binding_targets: {
      task: {
        id: `task:${TASK_ID}`,
        path: TASK_PATH,
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_job_name,
    flow_path: FLOW_PATH,
    format_version: 'state-machine-v2',
    job_outputs,
    job_visit_counts,
    run_id: attempt_context.run_id,
    task_id: TASK_ID,
    task_path: TASK_PATH,
  };
}
