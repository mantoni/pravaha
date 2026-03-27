// @module-tag lint-staged-excluded

/* eslint-disable max-lines, max-lines-per-function */
/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
/** @import { QueryGraphApi } from './patram-types.ts' */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { queryGraph } from 'patram';
import { expect, it } from 'vitest';

import { createSuccessRunResult } from './run-happy-path.assertions-test-helpers.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  createTaskFixture,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { reconcile } from './reconcile.js';
import { resume } from './resume.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from './runtime-attempt.state-machine-test-helpers.js';
import { createRuntimeRecord } from './runtime-record-model.js';

const run_query_graph = /** @type {QueryGraphApi['query_graph']} */ (
  queryGraph
);

it('requires an unresolved runtime record before resume can run', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      resume(temp_directory, {
        worker_client: {
          startThread() {
            throw new Error('resume should not start without a record');
          },
          resumeThread() {
            throw new Error('resume should not start without a record');
          },
        },
      }),
    ).rejects.toThrow('No unresolved runtime record is available to resume.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('requires an unresolved runtime record when resume uses default options', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(resume(temp_directory)).rejects.toThrow(
      'No unresolved runtime record is available to resume.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('uses the exact recorded task, worktree, and thread context during resume', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const worktree_path = join(temp_directory, '.pravaha/worktrees/resume-slot');
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const worker_harness = createResumeWorkerHarness();

  try {
    await writeUnresolvedRuntimeRecord(temp_directory, runtime_record_path, {
      prompt: 'Persisted prompt for strict resume.',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      worker_thread_id: 'thread-resume',
      worktree_path,
    });

    const run_result = await resume(temp_directory, {
      now: () => new Date('2026-03-25T10:00:00.000Z'),
      worker_client: worker_harness.worker_client,
    });
    const runtime_record = await loadRuntimeRecord(runtime_record_path);

    assertStrictResumeResult({
      run_result,
      runtime_record,
      runtime_record_path,
      temp_directory,
      worker_harness,
      worktree_path,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('does not re-select a different task during resume', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    task_documents: [
      createTaskFixture('zeta-task', 'ready'),
      createTaskFixture('alpha-task', 'ready'),
    ],
  });
  const worktree_path = join(temp_directory, '.pravaha/worktrees/zeta-task');
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/zeta.json',
  );

  try {
    await writeUnresolvedRuntimeRecord(temp_directory, runtime_record_path, {
      prompt: 'Resume the recorded zeta task only.',
      task_id: 'zeta-task',
      task_path: 'docs/tasks/runtime/zeta-task.md',
      worker_thread_id: 'thread-zeta',
      worktree_path,
    });

    const run_result = await resume(temp_directory, {
      worker_client: createResumeWorkerHarness().worker_client,
    });
    const alpha_task_text = await readFile(
      join(temp_directory, 'docs/tasks/runtime/alpha-task.md'),
      'utf8',
    );

    expect(run_result).toMatchObject({
      outcome: 'success',
      task_id: 'zeta-task',
      task_path: join(temp_directory, 'docs/tasks/runtime/zeta-task.md'),
      worktree_path,
    });
    expect(alpha_task_text).toContain('Status: ready');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads the project graph through the provided graph api during resume', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  /** @type {string | null} */
  let loaded_repo_directory = null;

  try {
    await writeUnresolvedRuntimeRecord(temp_directory, runtime_record_path, {
      prompt: 'Persisted prompt for strict resume.',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      worker_thread_id: 'thread-resume',
      worktree_path: join(
        temp_directory,
        '.pravaha/worktrees/implement-runtime-slice',
      ),
    });

    await resume(temp_directory, {
      graph_api: {
        async load_project_graph(repo_directory) {
          loaded_repo_directory = repo_directory;

          return {
            config: {},
            diagnostics: [],
            graph: {
              edges: [],
              nodes: {},
            },
          };
        },
        query_graph: run_query_graph,
      },
      worker_client: createResumeWorkerHarness().worker_client,
    });

    expect(loaded_repo_directory).toBe(temp_directory);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes a pending approval state-machine runtime record', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  review:',
    '    uses: core/approval',
    '    with:',
    '      title: Review runtime slice',
    '      message: Approve this runtime slice.',
    '      options: [approve]',
    '    next:',
    '      - if: ${{ result.verdict == "approve" }}',
    '        goto: done',
    '',
    '  done:',
    '    end: success',
  ]);

  try {
    const initial_result = await reconcile(temp_directory, {
      now: () => new Date('2026-03-25T09:00:00.000Z'),
      worker_client: createResumeWorkerHarness().worker_client,
    });

    if (initial_result.outcome === 'blocked') {
      throw new Error('Expected reconcile to start a state-machine flow.');
    }
    if (initial_result.runtime_record_path === null) {
      throw new Error('Expected reconcile to persist a runtime record.');
    }

    expect(initial_result.outcome).toBe('pending-approval');

    const resumed_result = await resume(temp_directory, {
      now: () => new Date('2026-03-25T09:05:00.000Z'),
      worker_client: createResumeWorkerHarness().worker_client,
    });
    const runtime_record = await loadRuntimeRecord(
      initial_result.runtime_record_path,
    );

    expect(resumed_result).toMatchObject({
      outcome: 'pending-approval',
      task_id: 'implement-runtime-slice',
    });
    expect(runtime_record).toMatchObject({
      format_version: 'state-machine-v2',
      job_state: {
        current_job_name: 'review',
        job_visit_counts: {
          review: 2,
        },
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('resumes a state-machine worker run on the recorded thread', async () => {
  const temp_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement ${{ task.path }}.',
    '    next: done',
    '',
    '  done:',
    '    end: success',
  ]);
  const runtime_record_path = join(
    temp_directory,
    '.pravaha/runtime/implement-runtime-slice.json',
  );
  const worktree_path = join(
    temp_directory,
    '.pravaha/worktrees/implement-runtime-slice',
  );
  const worker_harness = createResumeWorkerHarness();

  try {
    await writeStateMachineUnresolvedRuntimeRecord(
      runtime_record_path,
      worktree_path,
    );

    const resumed_result = await resume(temp_directory, {
      now: () => new Date('2026-03-25T09:05:00.000Z'),
      worker_client: worker_harness.worker_client,
    });
    const runtime_record = await loadRuntimeRecord(runtime_record_path);

    expect(resumed_result).toMatchObject({
      outcome: 'success',
      runtime_record_path,
      task_id: 'implement-runtime-slice',
      worker_thread_id: 'thread-state-machine-resume',
      worktree_path,
    });
    expect(worker_harness.resumed_prompt()).toContain(
      'Persisted prompt for the state-machine resume.',
    );
    expect(worker_harness.resumed_prompt()).toContain(
      'Implement docs/tasks/runtime/implement-runtime-slice.md.',
    );
    expect(worker_harness.resumed_thread_id()).toBe(
      'thread-state-machine-resume',
    );
    expect(runtime_record).toMatchObject({
      format_version: 'state-machine-v2',
      job_state: {
        current_job_name: 'done',
        job_outputs: {
          implement: {
            outcome: 'success',
          },
        },
      },
      local_outcome: {
        state: 'success',
      },
      worker: {
        thread_id: 'thread-state-machine-resume',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} repo_directory
 * @param {string} runtime_record_path
 * @param {{
 *   prompt: string,
 *   task_id: string,
 *   task_path: string,
 *   worker_thread_id: string | null,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<void>}
 */
async function writeUnresolvedRuntimeRecord(
  repo_directory,
  runtime_record_path,
  options,
) {
  await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
  await mkdir(options.worktree_path, { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(
      {
        contract_path: CONTRACT_PATH,
        flow_path: FLOW_PATH,
        lease: {
          leased_at: '2026-03-25T09:30:00.000Z',
        },
        local_outcome: {
          state: 'unresolved',
        },
        prompt: options.prompt,
        selected_task: {
          id: options.task_id,
          path: options.task_path,
        },
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
        worker: {
          error_message: null,
          final_response: null,
          item_count: 0,
          thread_id: options.worker_thread_id,
          usage: null,
        },
        worktree: {
          identity: 'castello',
          mode: 'named',
          path: options.worktree_path,
          slot: 'castello',
        },
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * @param {string} runtime_record_path
 * @param {string} worktree_path
 * @returns {Promise<void>}
 */
async function writeStateMachineUnresolvedRuntimeRecord(
  runtime_record_path,
  worktree_path,
) {
  await mkdir(dirname(runtime_record_path), { recursive: true });
  await mkdir(worktree_path, { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(
      createRuntimeRecord({
        contract_path: CONTRACT_PATH,
        current_job_name: 'implement',
        flow_path: FLOW_PATH,
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {},
        leased_at: '2026-03-25T09:00:00.000Z',
        outcome: null,
        prompt: 'Persisted prompt for the state-machine resume.',
        run_id: 'run:implement-runtime-slice:2026-03-25T09:00:00.000Z',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
        transition_targets: {
          failure: 'blocked',
          success: 'review',
        },
        worker_error: null,
        worker_final_response: null,
        worker_item_count: 0,
        worker_thread_id: 'thread-state-machine-resume',
        worker_usage: null,
        worktree_identity: 'ephemeral-implement-runtime-slice',
        worktree_mode: 'ephemeral',
        worktree_path,
      }),
      null,
      2,
    )}\n`,
  );
}

/**
 * @returns {{
 *   worker_client: {
 *     resumeThread: (
 *       thread_id: string,
 *       thread_options?: $12$openai$l$codex$j$sdk.ThreadOptions,
 *     ) => {
 *       id: string,
 *       run: (
 *         prompt: $12$openai$l$codex$j$sdk.Input,
 *       ) => Promise<{
 *         finalResponse: string,
 *         items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *         usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 *       }>,
 *     },
 *     startThread: () => never,
 *   },
 *   received_thread_options: () => $12$openai$l$codex$j$sdk.ThreadOptions | null | undefined,
 *   resumed_prompt: () => $12$openai$l$codex$j$sdk.Input | null,
 *   resumed_thread_id: () => string | null,
 * }}
 */
function createResumeWorkerHarness() {
  /** @type {$12$openai$l$codex$j$sdk.ThreadOptions | null | undefined} */
  let received_thread_options = null;
  /** @type {$12$openai$l$codex$j$sdk.Input | null} */
  let resumed_prompt = null;
  /** @type {string | null} */
  let resumed_thread_id = null;

  return {
    worker_client: {
      startThread() {
        throw new Error('resume must not start a new thread');
      },
      resumeThread(thread_id, thread_options) {
        received_thread_options = thread_options;
        resumed_thread_id = thread_id;

        return {
          id: thread_id,
          async run(prompt) {
            resumed_prompt = prompt;

            return createSuccessRunResult();
          },
        };
      },
    },
    received_thread_options() {
      return received_thread_options;
    },
    resumed_prompt() {
      return resumed_prompt;
    },
    resumed_thread_id() {
      return resumed_thread_id;
    },
  };
}

/**
 * @param {string} runtime_record_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadRuntimeRecord(runtime_record_path) {
  return /** @type {Record<string, unknown>} */ (
    JSON.parse(await readFile(runtime_record_path, 'utf8'))
  );
}

/**
 * @param {{
 *   run_result: Awaited<ReturnType<typeof resume>>,
 *   runtime_record: Record<string, unknown>,
 *   runtime_record_path: string,
 *   temp_directory: string,
 *   worker_harness: ReturnType<typeof createResumeWorkerHarness>,
 *   worktree_path: string,
 * }} options
 */
function assertStrictResumeResult(options) {
  expect(options.run_result).toMatchObject({
    outcome: 'success',
    runtime_record_path: options.runtime_record_path,
    task_id: 'implement-runtime-slice',
    task_path: join(
      options.temp_directory,
      'docs/tasks/runtime/implement-runtime-slice.md',
    ),
    worker_thread_id: 'thread-resume',
    worktree_path: options.worktree_path,
  });
  expect(options.worker_harness.resumed_thread_id()).toBe('thread-resume');
  expect(options.worker_harness.received_thread_options()).toMatchObject({
    approvalPolicy: 'never',
    modelReasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    workingDirectory: options.worktree_path,
  });
  expect(options.worker_harness.resumed_prompt()).toBe(
    'Persisted prompt for strict resume.',
  );
  expect(options.runtime_record).toMatchObject({
    local_outcome: {
      completed_at: '2026-03-25T10:00:00.000Z',
      state: 'success',
    },
    selected_task: {
      id: 'implement-runtime-slice',
      path: 'docs/tasks/runtime/implement-runtime-slice.md',
    },
    worker: {
      thread_id: 'thread-resume',
    },
    worktree: {
      identity: 'castello',
      mode: 'named',
      path: options.worktree_path,
      slot: 'castello',
    },
  });
}
