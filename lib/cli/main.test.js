import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import patram_config from '../../.patram.json' with { type: 'json' };
import package_json from '../../package.json' with { type: 'json' };
import pravaha_config from '../../pravaha.json' with { type: 'json' };
import { linkPravahaPackage } from '../../test/fixtures/runtime-fixture.js';

import { main } from './main.js';

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
    'pravaha approve --token <run_id> [path]',
  );
  expect(help_io_context.stdout_text()).toContain('pravaha worker [path]');
  expect(help_io_context.stdout_text()).toContain(
    'pravaha dispatch [--flow <flow_instance_id>] [path]',
  );
  expect(help_io_context.stdout_text()).toContain('pravaha status [path]');
  expect(help_io_context.stdout_text()).toContain(
    'pravaha queue <init|sync|pull|publish> [path]',
  );
  expect(help_io_context.stdout_text()).not.toContain(
    'pravaha reconcile [path]',
  );
  expect(help_io_context.stdout_text()).not.toContain('pravaha resume [path]');
  expect(version_io_context.stdout_text()).toBe(`${package_json.version}\n`);
});

it('supports the remaining short help and long version aliases', async () => {
  const help_io_context = createIoContext();
  const version_io_context = createIoContext();

  await expect(main(['-h'], help_io_context)).resolves.toBe(0);
  await expect(main(['--version'], version_io_context)).resolves.toBe(0);
  expect(help_io_context.stdout_text()).toContain(
    'pravaha dispatch [--flow <flow_instance_id>] [path]',
  );
  expect(help_io_context.stdout_text()).toContain('pravaha status [path]');
  expect(help_io_context.stdout_text()).toContain(
    'pravaha queue <init|sync|pull|publish> [path]',
  );
  expect(version_io_context.stdout_text()).toBe(`${package_json.version}\n`);
});

it('validates the repo config and checked-in flows', async () => {
  const io_context = createIoContext();
  const repo_directory = dirname(
    fileURLToPath(new URL('../../package.json', import.meta.url)),
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

          return Promise.resolve({
            contract_path:
              '/repo/docs/contracts/runtime/minimal-plugin-context-and-approval-ingress.md',
            outcome: 'success',
            prompt: 'prompt',
            root_flow_path:
              '/repo/docs/flows/runtime/minimal-plugin-context-and-approval-ingress.js',
            runtime_record_path: '/repo/.pravaha/runtime/task.json',
            task_id: 'implement-runtime-slice',
            task_path: '/repo/docs/tasks/runtime/implement-runtime-slice.md',
            worker_error: null,
            worker_final_response: null,
            worker_thread_id: null,
            worktree_path: '/repo/.pravaha/worktrees/implement-runtime-slice',
          });
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
      worker: () =>
        Promise.resolve({
          dispatcher_id: 'worker-dispatcher',
          endpoint: '/repo/.pravaha/dispatcher.sock',
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
      dispatch: () =>
        Promise.resolve({
          dispatcher_available: false,
          dispatcher_id: null,
          endpoint: '/repo/.pravaha/dispatcher.sock',
          notification_delivered: false,
          outcome: 'success',
        }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"notification_delivered": false');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the status command and reports grouped flow status to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['status', '/repo'], io_context, {
      status: () =>
        Promise.resolve({
          connected_worker_count: 2,
          dispatcher_available: true,
          dispatcher_id: 'worker-dispatcher',
          endpoint: '/repo/.pravaha/dispatcher.sock',
          flows_by_status: {
            failed: [],
            pending: [],
            running: [
              {
                checkout_directory: '/repo/.pravaha/worktrees/flow-instance-1',
                current_handler_name: 'main',
                flow_instance_id: 'flow-instance:1',
                worker_id: 'worker-helper',
              },
            ],
            succeeded: [],
            'waiting-approval': [],
            'waiting-queue': [],
          },
          outcome: 'success',
        }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"connected_worker_count": 2');
  expect(io_context.stdout_text()).toContain('"running"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the queue command and reports queue sync results to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['queue', 'sync', '/repo'], io_context, {
      syncQueue: () =>
        Promise.resolve({
          base_source: 'fetched-upstream',
          outcome: 'success',
          rejected_ready_refs: [],
          resumed_runs: [],
        }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"outcome": "success"');
  expect(io_context.stderr_text()).toBe('');
});

it('runs the queue init command and reports queue init results to stdout', async () => {
  const io_context = createIoContext();

  await expect(
    main(['queue', 'init', '/repo'], io_context, {
      initQueue: () =>
        Promise.resolve({
          base_source: 'fetched-upstream',
          base_ref: 'refs/queue/meta/base',
          candidate_ref: 'refs/queue/candidate/current',
          outcome: 'success',
          queue_git_dir: '/repo/.pravaha/queue.git',
          target_ref: 'refs/heads/main',
        }),
    }),
  ).resolves.toBe(0);

  expect(io_context.stdout_text()).toContain('"outcome": "success"');
  expect(io_context.stderr_text()).toBe('');
});

it('validates queue subcommands', async () => {
  const io_context = createIoContext();

  await expect(main(['queue', 'unknown', '/repo'], io_context)).resolves.toBe(
    1,
  );
  expect(io_context.stderr_text()).toContain(
    'Expected queue to receive <init|sync|pull|publish> [path].',
  );
});

it('reports Error command failures to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['worker', '/repo'], io_context, {
      worker: () => Promise.reject(new Error('Worker failed.')),
    }),
  ).resolves.toBe(1);

  expect(io_context.stderr_text()).toContain('Worker failed.');
});

it('reports non-Error command failures to stderr', async () => {
  const io_context = createIoContext();

  await expect(
    main(['dispatch', '/repo'], io_context, {
      dispatch: () => createStringRejectedPromise('plain failure'),
    }),
  ).resolves.toBe(1);

  expect(io_context.stderr_text()).toBe('plain failure\n');
});

it('requires a token for the approve command', async () => {
  const io_context = createIoContext();

  await expect(main(['approve', '/repo'], io_context)).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain(
    'Expected approve to receive --token <run_id> [path].',
  );
});

it('rejects approve when the token argument is blank', async () => {
  const io_context = createIoContext();

  await expect(
    main(['approve', '--token', '', '/repo'], io_context),
  ).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain(
    'Expected approve to receive --token <run_id> [path].',
  );
});

it('reports removed reconcile and resume commands as unknown', async () => {
  const reconcile_io_context = createIoContext();
  const resume_io_context = createIoContext();

  await expect(
    main(['reconcile', '/repo'], reconcile_io_context),
  ).resolves.toBe(1);
  await expect(main(['resume', '/repo'], resume_io_context)).resolves.toBe(1);
  expect(reconcile_io_context.stderr_text()).toContain(
    'Unknown command: reconcile',
  );
  expect(resume_io_context.stderr_text()).toContain('Unknown command: resume');
});

it('reports unknown commands with help text on stderr', async () => {
  const io_context = createIoContext();

  await expect(main(['mystery'], io_context)).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain('Unknown command: mystery');
  expect(io_context.stderr_text()).toContain('pravaha help');
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
 * @param {string} message
 * @returns {Promise<never>}
 */
function createStringRejectedPromise(message) {
  return /** @type {Promise<never>} */ ({
    then(_resolve, reject) {
      reject?.(message);

      return Promise.resolve();
    },
  });
}

/**
 * @returns {Promise<string>}
 */
async function createSingleFlowRepo() {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-cli-'));
  const flow_file_path = join(temp_directory, 'docs/flows/runtime/valid.js');

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
  await linkPravahaPackage(temp_directory);

  return temp_directory;
}

/**
 * @returns {string}
 */
function createFlowDocument() {
  return [
    "import { defineFlow } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    '    void ctx;',
    '  },',
    '});',
    '',
  ].join('\n');
}
