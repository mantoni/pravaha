import { expect, it } from 'vitest';

import { executeStateMachineAttempt } from './state-machine-execution.js';

it('fails clearly when the extracted execution loop receives an unknown current job', async () => {
  await expect(
    executeStateMachineAttempt('/repo', {
      attempt_context: {
        prompt: 'prompt',
        runtime_record_path: '/repo/.pravaha/runtime/demo.json',
        worktree_assignment: {
          identity: 'worktree-1',
          mode: 'pooled',
          path: '/repo/.pravaha/worktrees/demo',
        },
        worktree_path: '/repo/.pravaha/worktrees/demo',
      },
      now: () => new Date('2026-03-28T10:00:00.000Z'),
      ordered_jobs: [],
      runtime_record_context: {
        binding_targets: {
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: 'docs/contracts/runtime/job-state-machine-execution.md',
        current_job_name: 'missing',
        flow_path: 'docs/flows/runtime/test.yaml',
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {},
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      },
    }),
  ).rejects.toThrow('Unknown state-machine job "missing".');
});
