/* eslint-disable max-lines-per-function */
// @module-tag lint-staged-excluded

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { loadProjectGraph, queryGraph } from 'patram';

import { resume } from './resume.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from './runtime-attempt.state-machine-test-helpers.js';
import { createRuntimeRecord } from './runtime-record-model.js';
import { writeRuntimeRecord } from './runtime-files.js';

it('requires an unresolved runtime record before resume can run', async () => {
  const temp_directory = await createStateMachineFixtureRepo();

  try {
    await expect(resume(temp_directory)).rejects.toThrow(
      'No unresolved runtime record is available to resume.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes a pending approval state-machine runtime record', async () => {
  const temp_directory = await createStateMachineFixtureRepo({
    yaml_lines: [
      ...createStateMachinePreamble(),
      '  review:',
      '    uses: core/approval',
      '    with:',
      '      title: Review',
      '      message: Approve?',
      '      options: [approve]',
      '    next: done',
      '  done:',
      '    end: success',
    ],
  });
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeRuntimeRecord(
      runtime_record_path,
      createRuntimeRecord({
        approval: {
          approved_at: null,
          requested_at: '2026-03-27T10:00:00.000Z',
        },
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
        current_job_name: 'review',
        flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {
          implement: 1,
          review: 1,
        },
        leased_at: '2026-03-27T10:00:00.000Z',
        outcome: null,
        prompt: 'Persisted prompt.',
        run_id: 'run:implement-runtime-slice:2026-03-27T10:00:00.000Z',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: null,
        worker_final_response: null,
        worker_item_count: 0,
        worker_thread_id: null,
        worker_usage: null,
        worktree_identity: 'pooled-app-main',
        worktree_mode: 'pooled',
        worktree_path: join(
          temp_directory,
          '.pravaha/worktrees/pooled-app-main',
        ),
      }),
    );

    const run_result = await resume(temp_directory, {
      worker_client: {
        startThread() {
          throw new Error('approval resume should not start a worker');
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'pending-approval',
      runtime_record_path,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes a state-machine worker run on the recorded thread', async () => {
  const temp_directory = await createStateMachineFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeImplementRuntimeRecord(temp_directory, runtime_record_path);

    const run_result = await resume(temp_directory, {
      worker_client: {
        resumeThread(id) {
          expect(id).toBe('thread-state-machine-resume');

          return {
            id,
            async run() {
              return {
                items: [],
                finalResponse: '{"summary":"done"}',
                usage: null,
              };
            },
          };
        },
        startThread() {
          throw new Error('Expected resume to reuse the recorded thread.');
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'success',
      worker_thread_id: 'thread-state-machine-resume',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('falls back to starting a new worker thread when resumeThread is unavailable', async () => {
  const temp_directory = await createStateMachineFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeImplementRuntimeRecord(temp_directory, runtime_record_path);

    const run_result = await resume(temp_directory, {
      worker_client: {
        startThread() {
          return {
            id: 'thread-state-machine-restarted',
            async run() {
              return {
                items: [],
                finalResponse: '{"summary":"done"}',
                usage: null,
              };
            },
          };
        },
      },
    });

    expect(run_result).toMatchObject({
      outcome: 'success',
      worker_thread_id: 'thread-state-machine-restarted',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes when the loaded graph config omits explicit relations', async () => {
  const temp_directory = await createStateMachineFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );

  try {
    await writeImplementRuntimeRecord(temp_directory, runtime_record_path);

    const run_result = await resume(temp_directory, {
      graph_api: {
        async load_project_graph(repo_directory) {
          const project_graph = await loadProjectGraph(repo_directory);

          return {
            ...project_graph,
            config: {},
          };
        },
        query_graph: /** @type {any} */ (queryGraph),
      },
      worker_client: {
        resumeThread(id) {
          return {
            id,
            async run() {
              return {
                items: [],
                finalResponse: '{"summary":"done"}',
                usage: null,
              };
            },
          };
        },
        startThread() {
          throw new Error('Expected resume to reuse the recorded thread.');
        },
      },
    });

    expect(run_result.outcome).toBe('success');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} repo_directory
 * @param {string} runtime_record_path
 * @returns {Promise<void>}
 */
function writeImplementRuntimeRecord(repo_directory, runtime_record_path) {
  return writeRuntimeRecord(
    runtime_record_path,
    createRuntimeRecord({
      binding_targets: {
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: 'docs/contracts/runtime/single-task-flow-reconciler.md',
      current_job_name: 'implement',
      flow_path: 'docs/flows/runtime/single-task-flow-reconciler.md',
      format_version: 'state-machine-v2',
      job_outputs: {},
      job_visit_counts: {
        implement: 1,
      },
      leased_at: '2026-03-27T10:00:00.000Z',
      outcome: null,
      prompt: 'Persisted prompt.',
      run_id: 'run:implement-runtime-slice:2026-03-27T10:00:00.000Z',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      worker_error: null,
      worker_final_response: null,
      worker_item_count: 0,
      worker_thread_id: 'thread-state-machine-resume',
      worker_usage: null,
      worktree_identity: 'pooled-app-main',
      worktree_mode: 'pooled',
      worktree_path: join(repo_directory, '.pravaha/worktrees/pooled-app-main'),
    }),
  );
}
