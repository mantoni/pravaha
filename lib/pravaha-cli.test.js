import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };
import package_json from '../package.json' with { type: 'json' };
import pravaha_config from '../pravaha.json' with { type: 'json' };

import { main } from './pravaha-cli.js';

it('renders help when no command is provided', async () => {
  const io_context = createIoContext();

  await expect(main([], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('pravaha help');
});

it('prints the package version', async () => {
  const io_context = createIoContext();

  await expect(main(['version'], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toBe(`${package_json.version}\n`);
});

it('supports help and version aliases', async () => {
  const help_io_context = createIoContext();
  const version_io_context = createIoContext();

  await expect(main(['--help'], help_io_context)).resolves.toBe(0);
  await expect(main(['-v'], version_io_context)).resolves.toBe(0);
  expect(help_io_context.stdout_text()).toContain(
    'pravaha run-happy-path [path]',
  );
  expect(help_io_context.stdout_text()).toContain(
    'pravaha approve --token <run_id> [path]',
  );
  expect(help_io_context.stdout_text()).toContain('pravaha worker [path]');
  expect(help_io_context.stdout_text()).toContain('pravaha dispatch [path]');
  expect(help_io_context.stdout_text()).toContain('pravaha reconcile [path]');
  expect(help_io_context.stdout_text()).toContain('pravaha resume [path]');
  expect(version_io_context.stdout_text()).toBe(`${package_json.version}\n`);
});

it('validates the repo config and checked-in flows', async () => {
  const io_context = createIoContext();
  const repo_directory = dirname(
    fileURLToPath(new URL('../package.json', import.meta.url)),
  );

  await expect(main(['validate', repo_directory], io_context)).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('Validation passed.');
});

it('validates a single-flow repo and uses singular wording', async () => {
  const io_context = createIoContext();
  const temp_directory = await createSingleFlowRepo();

  try {
    await expect(main(['validate', temp_directory], io_context)).resolves.toBe(
      0,
    );
    expect(io_context.stdout_text()).toContain('Checked 1 flow document.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports validation failures and pluralizes the checked flow count', async () => {
  const io_context = createIoContext();

  await expect(
    main(['validate', '/definitely/missing'], io_context),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('Validation failed.');
  expect(io_context.stderr_text()).toContain('Checked 0 flow documents.');
});

it('runs the explicit happy-path command and reports success to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['run-happy-path', '/repo'], io_context, {
      run_happy_path: async () => ({
        contract_path: '/repo/docs/contracts/runtime/codex-sdk-happy-path.md',
        outcome: 'success',
        prompt: 'prompt',
        root_flow_path: '/repo/docs/flows/runtime/codex-sdk-happy-path.md',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        task_id: 'implement-runtime-slice',
        task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: null,
        worker_final_response: '{"summary":"ok"}',
        worker_thread_id: 'thread-success',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      }),
    }),
  ).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the explicit happy-path command and reports worker failure to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['run-happy-path', '/repo'], io_context, {
      run_happy_path: async () => ({
        contract_path: '/repo/docs/contracts/runtime/codex-sdk-happy-path.md',
        outcome: 'failure',
        prompt: 'prompt',
        root_flow_path: '/repo/docs/flows/runtime/codex-sdk-happy-path.md',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        task_id: 'implement-runtime-slice',
        task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        worker_final_response: null,
        worker_thread_id: 'thread-failure',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
        worker_error: 'Codex SDK run failed',
      }),
    }),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('"outcome": "failure"');
  expect(io_context.stderr_text()).toContain('Codex SDK run failed');
});

it('runs the reconciler command and reports success to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['reconcile', '/repo'], io_context, {
      reconcile: async () => ({
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        outcome: 'success',
        prompt: 'prompt',
        root_flow_path:
          '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        task_id: 'implement-runtime-slice',
        task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: null,
        worker_final_response: '{"summary":"ok"}',
        worker_thread_id: 'thread-success',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      }),
    }),
  ).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the reconciler command and reports no eligible task to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['reconcile', '/repo'], io_context, {
      reconcile: async () => ({
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        outcome: 'no-eligible-task',
        prompt: null,
        root_flow_path:
          '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_record_path: null,
        task_id: null,
        task_path: null,
        worker_error: null,
        worker_final_response: null,
        worker_thread_id: null,
        worktree_path: null,
      }),
    }),
  ).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain('"outcome": "no-eligible-task"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the reconciler command and reports blocked runtime state to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['reconcile', '/repo'], io_context, {
      reconcile: async () => ({
        blocking_message:
          'Reconcile blocked by unresolved runtime state. Resume or resolve the recorded run before reconciling again.',
        blocking_records: [
          {
            contract_path:
              '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
            leased_at: '2026-03-25T09:00:00.000Z',
            local_outcome_state: 'unresolved',
            root_flow_path:
              '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
            runtime_record_path: '/repo/.pravaha/runtime/task.json',
            task_id: 'implement-runtime-slice',
            task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
            worker_thread_id: 'thread-resume',
            worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
          },
        ],
        outcome: 'blocked',
      }),
    }),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('"outcome": "blocked"');
  expect(io_context.stderr_text()).toContain('thread-resume');
});

it('runs the reconciler command and reports worker failure to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['reconcile', '/repo'], io_context, {
      reconcile: async () => ({
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        outcome: 'failure',
        prompt: 'prompt',
        root_flow_path:
          '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        task_id: 'implement-runtime-slice',
        task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: 'Codex SDK run failed',
        worker_final_response: null,
        worker_thread_id: 'thread-failure',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      }),
    }),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('"outcome": "failure"');
});

it('reports non-Error happy-path command failures', async () => {
  const io_context = createIoContext();

  await expect(
    main(['run-happy-path', '/repo'], io_context, {
      run_happy_path: async () => {
        throw 'plain failure';
      },
    }),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toBe('plain failure\n');
});

it('runs the resume command and reports success to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['resume', '/repo'], io_context, {
      resume: async () => ({
        contract_path:
          '/repo/docs/contracts/runtime/single-task-flow-reconciler.md',
        outcome: 'success',
        prompt: 'prompt',
        root_flow_path:
          '/repo/docs/flows/runtime/single-task-flow-reconciler.md',
        runtime_record_path: '/repo/.pravaha/runtime/task.json',
        task_id: 'implement-runtime-slice',
        task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
        worker_error: null,
        worker_final_response: '{"summary":"ok"}',
        worker_thread_id: 'thread-resume',
        worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
      }),
    }),
  ).resolves.toBe(0);
  expect(io_context.stdout_text()).toContain(
    '"worker_thread_id": "thread-resume"',
  );
  expect(io_context.stderr_text()).toBe('');
});

it('runs the approve command with a run token and reports success to stdout', async () => {
  const io_context = createIoContext();
  /** @type {{ repo_directory: string | null, token: string | null }} */
  const received_call = {
    repo_directory: null,
    token: null,
  };

  await expect(
    main(
      ['approve', '--token', 'run:task:2026-03-26T10:00:00.000Z', '/repo'],
      io_context,
      {
        approve: async (repo_directory, options) => {
          received_call.repo_directory = repo_directory;
          received_call.token = options.token;

          return {
            contract_path:
              '/repo/docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md',
            outcome: 'success',
            prompt: 'prompt',
            root_flow_path:
              '/repo/docs/flows/runtime/minimal-plugin-context-and-approval-ingress.md',
            runtime_record_path: '/repo/.pravaha/runtime/task.json',
            task_id: 'implement-runtime-slice',
            task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
            worker_error: null,
            worker_final_response: null,
            worker_thread_id: null,
            worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
          };
        },
      },
    ),
  ).resolves.toBe(0);

  expect(received_call).toEqual({
    repo_directory: '/repo',
    token: 'run:task:2026-03-26T10:00:00.000Z',
  });
  expect(io_context.stdout_text()).toContain('"outcome": "success"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the worker command and reports the stopped worker summary to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['worker', '/repo'], io_context, {
      worker: async () => ({
        dispatcher_id: 'worker-dispatcher',
        endpoint: '/repo/.pravaha/dispatch/leader.sock',
        outcome: 'stopped',
        role: 'dispatcher',
        worker_id: 'worker-dispatcher',
      }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"outcome": "stopped"');
  expect(io_context.stdout_text()).toContain('"role": "dispatcher"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the dispatch command and reports best-effort success to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['dispatch', '/repo'], io_context, {
      dispatch: async () => ({
        dispatcher_available: false,
        dispatcher_id: null,
        endpoint: '/repo/.pravaha/dispatch/leader.sock',
        notification_delivered: false,
        outcome: 'success',
      }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"notification_delivered": false');
  expect(io_context.stderr_text()).toBe('');
});

it('requires a token for the approve command', async () => {
  const io_context = createIoContext();

  await expect(main(['approve', '/repo'], io_context)).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain(
    'Expected approve to receive --token <run_id> [path].',
  );
});

it('reports resume command failures to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['resume', '/repo'], io_context, {
      resume: async () => {
        throw new Error('No unresolved runtime record is available to resume.');
      },
    }),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain(
    'No unresolved runtime record is available to resume.',
  );
});

it('reports unknown commands to stderr', async () => {
  const io_context = createIoContext();

  await expect(main(['unknown'], io_context)).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('Unknown command: unknown');
});

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
    stderr_text() {
      return stderr;
    },
    stdout: {
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stdout_text() {
      return stdout;
    },
  };
}

/**
 * @returns {Promise<string>}
 */
async function createSingleFlowRepo() {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-cli-'));
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/codex-sdk-happy-path.md',
  );

  await mkdir(dirname(flow_file_path), { recursive: true });
  await writeFile(
    join(temp_directory, '.patram.json'),
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );
  await writeFile(
    join(temp_directory, 'pravaha.json'),
    `${JSON.stringify(pravaha_config, null, 2)}\n`,
  );
  await writeFile(flow_file_path, createFlowDocument());

  return temp_directory;
}

/**
 * @returns {string}
 */
function createFlowDocument() {
  return [
    '---',
    'Kind: flow',
    'Id: codex-sdk-happy-path',
    'Status: active',
    '---',
    '',
    '# Codex SDK Happy Path',
    '',
    '```yaml',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document',
    'jobs:',
    '  run_first_ready_task:',
    '    steps:',
    '      - transition:',
    '          target: task',
    '          status: review',
    '```',
    '',
  ].join('\n');
}
