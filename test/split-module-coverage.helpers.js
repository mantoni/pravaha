import { createRuntimeRecord } from '../lib/runtime-record-model.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from '../lib/runtime-attempt.state-machine-test-helpers.js';

export {
  createIoContext,
  createResumeFixtureRepo,
  createResumeRuntimeRecord,
  createResumeWorkerClient,
};

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout_text: () => string,
 * }}
 */
function createIoContext() {
  let stdout = '';
  let stderr = '';

  return {
    stderr: {
      write(chunk) {
        stderr += chunk;

        return true;
      },
    },
    stdout: {
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stderr_text() {
      return stderr;
    },
    stdout_text() {
      return stdout;
    },
  };
}

/** @returns {Promise<string>} */
async function createResumeFixtureRepo() {
  return createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Resume.',
    '    next: done',
    '  done:',
    '    end: success',
  ]);
}

/**
 * @param {string} temp_directory
 * @returns {ReturnType<typeof createRuntimeRecord>}
 */
function createResumeRuntimeRecord(temp_directory) {
  return createRuntimeRecord({
    binding_targets: {
      task: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/job-state-machine-execution.md',
    current_job_name: 'implement',
    flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: {},
    leased_at: '2026-03-28T10:00:00.000Z',
    outcome: null,
    prompt: 'prompt',
    run_id: 'run:implement-runtime-slice:2026-03-28T10:00:00.000Z',
    task_id: 'implement-runtime-slice',
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    worker_error: null,
    worker_final_response: null,
    worker_item_count: 0,
    worker_thread_id: null,
    worker_usage: null,
    worktree_identity: 'worktree-1',
    worktree_mode: 'pooled',
    worktree_path: temp_directory,
  });
}

/**
 * @param {string[]} started_threads
 * @param {string[]} resumed_threads
 * @returns {{
 *   resumeThread: (thread_id: string) => {
 *     id: string,
 *     run: (input: string, turn_options?: unknown) => Promise<{
 *       finalResponse: string,
 *       id: string,
 *       itemCount: number,
 *       items: never[],
 *       usage: null,
 *     }>,
 *   },
 *   startThread: () => {
 *     id: null,
 *     run: (input: string, turn_options?: unknown) => Promise<{
 *       finalResponse: string,
 *       id: null,
 *       itemCount: number,
 *       items: never[],
 *       usage: null,
 *     }>,
 *   },
 * }}
 */
function createResumeWorkerClient(started_threads, resumed_threads) {
  return {
    /**
     * @param {string} thread_id
     */
    resumeThread(thread_id) {
      resumed_threads.push(thread_id);

      return {
        id: thread_id,
        async run() {
          return {
            finalResponse: 'unused',
            id: thread_id,
            itemCount: 0,
            items: [],
            usage: null,
          };
        },
      };
    },
    startThread() {
      started_threads.push('started');

      return {
        id: null,
        async run() {
          return {
            finalResponse: 'completed',
            id: null,
            itemCount: 0,
            items: [],
            usage: null,
          };
        },
      };
    },
  };
}
