import { beforeEach, expect, it, vi } from 'vitest';

const { executeStateMachineAction } = vi.hoisted(() => {
  return {
    executeStateMachineAction: vi.fn(),
  };
});

const { writeFinalRuntimeRecord, writeUnresolvedRuntimeRecord } = vi.hoisted(
  () => {
    return {
      writeFinalRuntimeRecord: vi.fn(),
      writeUnresolvedRuntimeRecord: vi.fn(),
    };
  },
);

vi.mock('./core-actions.js', () => {
  return {
    executeStateMachineAction,
  };
});

vi.mock('./runtime-attempt-records.js', () => {
  return {
    writeFinalRuntimeRecord,
    writeUnresolvedRuntimeRecord,
  };
});

import { executeStateMachineAttempt } from './state-machine-execution.js';

beforeEach(() => {
  executeStateMachineAction.mockReset();
  writeFinalRuntimeRecord.mockReset();
  writeUnresolvedRuntimeRecord.mockReset();

  writeFinalRuntimeRecord.mockResolvedValue({});
  writeUnresolvedRuntimeRecord.mockResolvedValue({});
});

it('fails clearly when the extracted execution loop receives an unknown current job', async () => {
  await expect(
    executeStateMachineAttempt(
      '/repo',
      createStateMachineAttemptOptions('missing', []),
    ),
  ).rejects.toThrow('Unknown state-machine job "missing".');
});

it('persists a terminal failure when an action throws unexpectedly', async () => {
  executeStateMachineAction.mockRejectedValueOnce(new Error('branch failed'));

  await expect(
    executeStateMachineAttempt(
      '/repo',
      createStateMachineAttemptOptions('implement', [
        {
          job_name: 'implement',
          kind: 'action',
          limits: null,
          next_branches: [
            {
              condition_text: null,
              target_job_name: 'done',
            },
          ],
          uses_value: 'core/worktree-handoff',
          with_value: {
            branch: 'review/ready/${{ doc.id }}',
          },
        },
        {
          end_state: 'success',
          job_name: 'done',
          kind: 'end',
        },
      ]),
    ),
  ).resolves.toMatchObject({
    outcome: 'failure',
    worker_error: 'branch failed',
  });

  expect(writeUnresolvedRuntimeRecord).toHaveBeenCalledTimes(1);
  expect(writeFinalRuntimeRecord).toHaveBeenCalledTimes(1);
  expect(writeFinalRuntimeRecord).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(Object),
    expect.objectContaining({
      outcome: 'failure',
      worker_error: 'branch failed',
    }),
    expect.any(Function),
  );
});

/**
 * @param {string} current_job_name
 * @param {Array<
 *   | {
 *       end_state: string,
 *       job_name: string,
 *       kind: 'end',
 *     }
 *   | {
 *       job_name: string,
 *       kind: 'action',
 *       limits: { max_visits: number } | null,
 *       next_branches: Array<{
 *         condition_text: string | null,
 *         target_job_name: string,
 *       }>,
 *       uses_value: string,
 *       with_value: unknown,
 *     }
 * >} ordered_jobs
 * @returns {Parameters<typeof executeStateMachineAttempt>[1]}
 */
function createStateMachineAttemptOptions(current_job_name, ordered_jobs) {
  return {
    attempt_context: {
      prompt: 'prompt',
      run_id: 'run:task:2026-03-29T10:00:00.000Z',
      runtime_record_path: '/repo/.pravaha/runtime/demo.json',
      worktree_assignment: {
        identity: 'worktree-1',
        mode: 'pooled',
        path: '/repo/.pravaha/worktrees/demo',
      },
      worktree_path: '/repo/.pravaha/worktrees/demo',
    },
    now: () => new Date('2026-03-29T10:05:00.000Z'),
    ordered_jobs,
    runtime_record_context: {
      binding_targets: {
        doc: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: 'docs/contracts/runtime/job-state-machine-execution.md',
      current_job_name,
      flow_path: 'docs/flows/runtime/test.yaml',
      format_version: 'state-machine-v2',
      job_outputs: {},
      job_visit_counts: {},
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
    },
  };
}
