/* eslint-disable max-lines-per-function */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createFixtureRepo } from '../../../test/fixtures/runtime-fixture.js';

const { resumeTaskAttemptMock, runStateMachineAttemptMock } = vi.hoisted(
  () => ({
    resumeTaskAttemptMock: vi.fn(),
    runStateMachineAttemptMock: vi.fn(),
  }),
);

vi.mock('../attempts/state-machine.js', () => ({
  resumeTaskAttempt: resumeTaskAttemptMock,
  runStateMachineAttempt: runStateMachineAttemptMock,
}));

afterEach(() => {
  vi.resetAllMocks();
});

it('resumes a persisted runtime record before dispatch execution continues', async () => {
  const { executeAssignedFlowInstance } = await import('./assignments.js');
  const repo_directory = await createFixtureRepo();
  const runtime_record_path = join(
    repo_directory,
    '.pravaha/runtime/resume-runtime.json',
  );

  try {
    await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
    await writeFile(
      runtime_record_path,
      `${JSON.stringify(
        {
          binding_targets: {
            task: {
              id: 'task:implement-runtime-slice',
              path: 'docs/tasks/runtime/implement-runtime-slice.md',
              status: 'ready',
            },
          },
          contract_path:
            'docs/contracts/runtime/single-task-flow-reconciler.md',
          execution: {
            run_id: 'run:implement-runtime-slice:2026-03-29T09:00:00.000Z',
          },
          flow_instance_id: 'flow-instance:resume-runtime',
          flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
          format_version: 'state-machine-v2',
          job_state: {
            current_job_name: 'implement',
            job_outputs: {},
            job_visit_counts: {
              implement: 1,
            },
          },
          local_outcome: {
            state: 'pending',
          },
          selected_task: {
            id: 'implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
          },
        },
        null,
        2,
      )}\n`,
    );
    resumeTaskAttemptMock.mockResolvedValue({
      outcome: 'success',
      worker_error: null,
    });

    await expect(
      executeAssignedFlowInstance(
        {
          assignment_id: 'assignment-resume-runtime',
          flow_instance_id: 'flow-instance:resume-runtime',
          resume_runtime_record_path: runtime_record_path,
          type: 'assignment',
        },
        {
          emit_event() {
            return Promise.resolve();
          },
          endpoint: '/tmp/dispatcher.sock',
          graph_api: {
            load_project_graph() {
              return Promise.resolve({
                config: {
                  relations: {},
                },
                diagnostics: [],
                graph: {
                  edges: [],
                  nodes: {},
                },
              });
            },
            query_graph() {
              return {
                diagnostics: [],
                nodes: [],
              };
            },
          },
          log_to_operator() {},
          now() {
            return new Date('2026-03-29T09:00:00.000Z');
          },
          repo_directory,
          worker_id: 'worker-runtime',
        },
      ),
    ).resolves.toEqual({
      outcome: 'success',
      worker_error: null,
    });
    expect(resumeTaskAttemptMock).toHaveBeenCalledTimes(1);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects resume assignments whose runtime record JSON is not an object', async () => {
  const { executeAssignedFlowInstance } = await import('./assignments.js');
  const repo_directory = await createFixtureRepo();
  const runtime_record_path = join(
    repo_directory,
    '.pravaha/runtime/invalid-runtime.json',
  );

  try {
    await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
    await writeFile(runtime_record_path, '[]\n');

    await expect(
      executeAssignedFlowInstance(
        {
          assignment_id: 'assignment-invalid-runtime',
          flow_instance_id: 'flow-instance:invalid-runtime',
          resume_runtime_record_path: runtime_record_path,
          type: 'assignment',
        },
        {
          emit_event() {
            return Promise.resolve();
          },
          endpoint: '/tmp/dispatcher.sock',
          graph_api: {
            load_project_graph() {
              throw new Error(
                'Did not expect graph loading after parse failure.',
              );
            },
            query_graph() {
              return {
                diagnostics: [],
                nodes: [],
              };
            },
          },
          log_to_operator() {},
          now() {
            return new Date('2026-03-29T09:00:00.000Z');
          },
          repo_directory,
          worker_id: 'worker-runtime',
        },
      ),
    ).rejects.toThrow('Expected runtime record JSON to evaluate to an object.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});
