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
  expect(help_io_context.stdout_text()).toContain('pravaha reconcile [path]');
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
    'jobs:',
    '  run_first_ready_task:',
    '    select:',
    '      role: task',
    '    steps:',
    '      - transition:',
    '          to: review',
    '```',
    '',
  ].join('\n');
}
