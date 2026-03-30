/* eslint-disable max-lines-per-function */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { resolveDispatchEndpoint } from '../dispatch/protocol.js';
import { readRuntimeRecordFlowInstanceId } from '../dispatch/flow-instance.js';
import { status } from './status.js';

it('groups durable runtime records when no dispatcher is running', async () => {
  const repo_directory = await mkdtemp(join(tmpdir(), 'pravaha-status-'));

  try {
    await writeStatusFixture(repo_directory, 'pending.json', {
      binding_target_id: 'task:pending',
      task_id: 'pending-task',
      task_path: 'docs/tasks/runtime/pending-task.md',
      worktree_path: '/repo/.pravaha/worktrees/pending-task',
    });
    await writeStatusFixture(repo_directory, 'waiting-approval.json', {
      approval: {
        approved_at: null,
        requested_at: '2026-03-29T10:00:00.000Z',
      },
      binding_target_id: 'task:approval',
      task_id: 'approval-task',
      task_path: 'docs/tasks/runtime/approval-task.md',
      worktree_path: '/repo/.pravaha/worktrees/approval-task',
    });
    await writeStatusFixture(repo_directory, 'waiting-queue.json', {
      binding_target_id: 'task:queue',
      queue_wait: {
        branch_head: 'abc123',
        branch_ref: 'refs/heads/review/queue',
        outcome: null,
        ready_ref: 'refs/queue/ready/1',
        state: 'waiting',
      },
      task_id: 'queue-task',
      task_path: 'docs/tasks/runtime/queue-task.md',
      worktree_path: '/repo/.pravaha/worktrees/queue-task',
    });
    await writeStatusFixture(repo_directory, 'success.json', {
      binding_target_id: 'task:success',
      local_outcome_state: 'success',
      task_id: 'success-task',
      task_path: 'docs/tasks/runtime/success-task.md',
      worktree_path: '/repo/.pravaha/worktrees/success-task',
    });
    await writeStatusFixture(repo_directory, 'failure.json', {
      binding_target_id: 'task:failure',
      local_outcome_state: 'failure',
      task_id: 'failure-task',
      task_path: 'docs/tasks/runtime/failure-task.md',
      worktree_path: '/repo/.pravaha/worktrees/failure-task',
    });

    await expect(status(repo_directory)).resolves.toMatchObject({
      connected_worker_count: 0,
      dispatcher_available: false,
      flows_by_status: {
        failed: [
          {
            current_job_name: 'implement',
            task_id: 'failure-task',
          },
        ],
        pending: [
          {
            current_job_name: 'implement',
            task_id: 'pending-task',
          },
        ],
        running: [],
        succeeded: [
          {
            current_job_name: 'implement',
            task_id: 'success-task',
          },
        ],
        'waiting-approval': [
          {
            current_job_name: 'implement',
            task_id: 'approval-task',
          },
        ],
        'waiting-queue': [
          {
            current_job_name: 'implement',
            task_id: 'queue-task',
          },
        ],
      },
      outcome: 'success',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('overlays live running assignments and connected worker count from the dispatcher', async () => {
  const repo_directory = await mkdtemp(join(tmpdir(), 'pravaha-status-'));
  const endpoint = await resolveDispatchEndpoint(repo_directory, 'darwin');
  const runtime_record = createRuntimeRecordFixture({
    binding_target_id: 'task:running',
    task_id: 'running-task',
    task_path: 'docs/tasks/runtime/running-task.md',
    worktree_path: '/repo/.pravaha/worktrees/running-task',
  });
  const flow_instance_id = readRuntimeRecordFlowInstanceId(runtime_record);
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += String(chunk);

      if (!buffer.includes('\n')) {
        return;
      }

      socket.write(
        `${JSON.stringify({
          active_assignments: [
            {
              flow_instance_id,
              worker_id: 'worker-helper',
            },
          ],
          connected_worker_count: 2,
          dispatcher_id: 'worker-dispatcher',
          type: 'status_report',
        })}\n`,
      );
      socket.end();
    });
  });

  await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
  await writeFile(
    join(repo_directory, '.pravaha/runtime/running.json'),
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
  await new Promise((resolve) => {
    server.listen(endpoint.address, () => {
      resolve(undefined);
    });
  });

  try {
    await expect(
      status(repo_directory, { platform: 'darwin' }),
    ).resolves.toMatchObject({
      connected_worker_count: 2,
      dispatcher_available: true,
      dispatcher_id: 'worker-dispatcher',
      flows_by_status: {
        pending: [],
        running: [
          {
            checkout_directory: '/repo/.pravaha/worktrees/running-task',
            flow_instance_id,
            task_id: 'running-task',
            worker_id: 'worker-helper',
          },
        ],
      },
      outcome: 'success',
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve(undefined);
      });
    });
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails when the dispatcher returns an unexpected live status message', async () => {
  const repo_directory = await mkdtemp(join(tmpdir(), 'pravaha-status-'));
  const endpoint = await resolveDispatchEndpoint(repo_directory, 'darwin');
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += String(chunk);

      if (!buffer.includes('\n')) {
        return;
      }

      socket.write(
        `${JSON.stringify({
          dispatcher_id: 'worker-dispatcher',
          type: 'dispatch_notified',
        })}\n`,
      );
      socket.end();
    });
  });

  await new Promise((resolve) => {
    server.listen(endpoint.address, () => {
      resolve(undefined);
    });
  });

  try {
    await expect(
      status(repo_directory, { platform: 'darwin' }),
    ).rejects.toThrow('Expected status_report, received dispatch_notified.');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve(undefined);
      });
    });
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} repo_directory
 * @param {string} file_name
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_target_id: string,
 *   local_outcome_state?: 'failure' | 'success' | 'unresolved',
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   task_id: string,
 *   task_path: string,
 *   worktree_path: string,
 * }} options
 * @returns {Promise<void>}
 */
async function writeStatusFixture(repo_directory, file_name, options) {
  await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
  await writeFile(
    join(repo_directory, '.pravaha/runtime', file_name),
    `${JSON.stringify(createRuntimeRecordFixture(options), null, 2)}\n`,
  );
}

/**
 * @param {{
 *   approval?: {
 *     approved_at: string | null,
 *     requested_at: string,
 *   },
 *   binding_target_id: string,
 *   local_outcome_state?: 'failure' | 'success' | 'unresolved',
 *   queue_wait?: {
 *     branch_head: string,
 *     branch_ref: string,
 *     outcome: 'failure' | 'success' | null,
 *     ready_ref: string,
 *     state: 'failed' | 'succeeded' | 'waiting',
 *   },
 *   task_id: string,
 *   task_path: string,
 *   worktree_path: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createRuntimeRecordFixture(options) {
  return {
    approval: options.approval,
    binding_targets: {
      task: {
        id: options.binding_target_id,
        path: options.task_path,
        status: 'ready',
      },
    },
    contract_path: 'docs/contracts/runtime/status-command.md',
    execution: {
      run_id: `run:${options.task_id}`,
    },
    flow_instance_id: options.task_id,
    flow_path: 'docs/flows/runtime/status-command.yaml',
    format_version: 'state-machine-v2',
    job_state: {
      current_job_name: 'implement',
      job_outputs: {},
      job_visit_counts: {
        implement: 1,
      },
    },
    local_outcome: {
      state: options.local_outcome_state ?? 'unresolved',
    },
    queue_wait: options.queue_wait,
    selected_task: {
      id: options.task_id,
      path: options.task_path,
    },
    worktree: {
      identity: `pooled-${options.task_id}`,
      mode: 'pooled',
      path: options.worktree_path,
    },
  };
}
