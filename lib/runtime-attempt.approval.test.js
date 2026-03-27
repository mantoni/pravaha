/* eslint-disable max-lines-per-function */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { approve } from './approve.js';
import { CONTRACT_PATH, FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginRuntimeFixtureFiles,
} from './plugin.fixture-test-helpers.js';
import { runTaskAttempt } from './runtime-attempt.js';

it('exposes only the curated stable plugin context fields', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'docs/contracts/runtime/parent-contract.md': [
        '---',
        'Kind: contract',
        'Id: parent-contract',
        'Status: active',
        '---',
        '# Parent Contract',
        '',
      ].join('\n'),
      'plugins/capture-context.js': createPluginModuleSource({
        emits_source: [
          '{',
          '  context_captured: z.object({',
          '    console_keys: z.array(z.string()),',
          '    context_keys: z.array(z.string()),',
          '    document_id: z.string(),',
          '    repo_directory: z.string(),',
          '    run_id: z.string(),',
          '    task_id: z.string(),',
          '    task_status: z.string(),',
          '    with_label: z.string(),',
          '    worktree_path: z.string(),',
          '  }),',
          '}',
        ].join('\n'),
        run_source: [
          "    await context.emit('context_captured', {",
          '      console_keys: Object.keys(context.console).sort(),',
          '      context_keys: Object.keys(context).sort(),',
          '      document_id: context.document.id,',
          '      repo_directory: context.repo_directory,',
          '      run_id: context.run_id,',
          '      task_id: context.task.id,',
          '      task_status: context.task.status,',
          '      with_label: context.with.label,',
          '      worktree_path: context.worktree_path,',
          '    });',
        ].join('\n'),
        with_source: 'z.object({ label: z.string() })',
      }),
    }),
  });

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query:
        '$class == $signal and kind == context_captured and subject == task',
      binding_targets: {
        document: {
          id: 'contract:parent-contract',
          path: 'docs/contracts/runtime/parent-contract.md',
          status: 'active',
        },
        task: {
          id: 'task:implement-runtime-slice',
          path: 'docs/tasks/runtime/implement-runtime-slice.md',
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/capture-context',
          with_value: {
            label: 'review',
          },
        },
      ],
      runtime_label: 'Plugin runtime slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worktree_policy: {
        mode: 'ephemeral',
      },
    });
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );
    const task_signal = runtime_record.signals.find(
      /**
       * @param {{ subject?: string }} signal_record
       */
      (signal_record) => signal_record.subject === 'task',
    );

    expect(run_result.outcome).toBe('success');
    expect(runtime_record.signals).toHaveLength(2);
    expect(task_signal).toMatchObject({
      kind: 'context_captured',
      payload: {
        console_keys: ['error', 'info', 'log', 'warn'],
        context_keys: [
          'console',
          'document',
          'emit',
          'repo_directory',
          'requestApproval',
          'run_id',
          'task',
          'with',
          'worktree_path',
        ],
        document_id: 'contract:parent-contract',
        repo_directory: temp_directory,
        task_id: 'task:implement-runtime-slice',
        task_status: 'ready',
        with_label: 'review',
        worktree_path: run_result.worktree_path,
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('prints standard approval output and keeps one plugin-backed step unresolved until approved', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/request-approval.js': createPluginModuleSource({
        emits_source:
          '{ approval_granted: z.object({ run_id: z.string(), task_id: z.string() }) }',
        run_source: [
          "    const { appendFile } = await import('node:fs/promises');",
          "    const { join } = await import('node:path');",
          "    await appendFile(join(context.worktree_path, 'runs.log'), 'entered\\n');",
          '    await context.requestApproval();',
          "    await context.emit('approval_granted', {",
          '      run_id: context.run_id,',
          '      task_id: context.task.id,',
          '    });',
        ].join('\n'),
      }),
    }),
  });
  const io_context = createIoContext();

  try {
    const run_result = await runTaskAttempt(temp_directory, {
      await_query:
        '$class == $signal and kind == approval_granted and subject == task',
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      operator_io: io_context,
      ordered_steps: [
        {
          kind: 'uses',
          step_name: 'local/request-approval',
        },
      ],
      runtime_label: 'Plugin runtime slice',
      task_id: 'implement-runtime-slice',
      task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
      worktree_policy: {
        mode: 'ephemeral',
      },
    });
    const runtime_record = JSON.parse(
      await readFile(run_result.runtime_record_path, 'utf8'),
    );

    expect(run_result.outcome).toBe('pending-approval');
    expect(io_context.stdout_text()).toContain('Approval requested.');
    expect(io_context.stdout_text()).toContain(
      `pravaha approve --token ${runtime_record.execution.run_id}`,
    );
    expect(runtime_record.local_outcome.state).toBe('unresolved');
    expect(runtime_record.execution.next_step_index).toBe(0);
    expect(runtime_record.signals).toEqual([]);
    expect(runtime_record.approval).toMatchObject({
      approved_at: null,
    });
    expect(
      await readFile(join(run_result.worktree_path, 'runs.log'), 'utf8'),
    ).toBe('entered\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('keeps the default approval path silent for library callers', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'plugins/request-approval.js': createPluginModuleSource({
        emits_source:
          '{ approval_granted: z.object({ run_id: z.string(), task_id: z.string() }) }',
        run_source: [
          '    await context.requestApproval();',
          "    await context.emit('approval_granted', {",
          '      run_id: context.run_id,',
          '      task_id: context.task.id,',
          '    });',
        ].join('\n'),
      }),
    }),
  });
  const stdout_write = vi.spyOn(process.stdout, 'write');
  const stderr_write = vi.spyOn(process.stderr, 'write');

  try {
    const run_result = await runPendingApprovalAttempt(
      temp_directory,
      'implement-runtime-slice',
      'docs/tasks/runtime/implement-runtime-slice.md',
    );

    expect(run_result.outcome).toBe('pending-approval');
    expect(stdout_write).not.toHaveBeenCalled();
    expect(stderr_write).not.toHaveBeenCalled();
  } finally {
    stdout_write.mockRestore();
    stderr_write.mockRestore();
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('routes approval by run token and re-enters the plugin step idempotently on resume', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginRuntimeFixtureFiles({
      'docs/tasks/runtime/second-runtime-slice.md': [
        '---',
        'Kind: task',
        'Id: second-runtime-slice',
        'Status: ready',
        `Tracked in: ${CONTRACT_PATH}`,
        '---',
        '# Second Runtime Slice',
        '',
      ].join('\n'),
      'plugins/request-approval.js': createPluginModuleSource({
        emits_source:
          '{ approval_granted: z.object({ run_id: z.string(), task_id: z.string() }) }',
        run_source: [
          "    const { appendFile } = await import('node:fs/promises');",
          "    const { join } = await import('node:path');",
          "    await appendFile(join(context.worktree_path, 'runs.log'), 'entered\\n');",
          '    await context.requestApproval();',
          "    await context.emit('approval_granted', {",
          '      run_id: context.run_id,',
          '      task_id: context.task.id,',
          '    });',
        ].join('\n'),
      }),
    }),
  });

  try {
    const first_run_result = await runPendingApprovalAttempt(
      temp_directory,
      'implement-runtime-slice',
      'docs/tasks/runtime/implement-runtime-slice.md',
    );
    const second_run_result = await runPendingApprovalAttempt(
      temp_directory,
      'second-runtime-slice',
      'docs/tasks/runtime/second-runtime-slice.md',
    );
    const second_runtime_record = JSON.parse(
      await readFile(second_run_result.runtime_record_path, 'utf8'),
    );

    const approve_result = await approve(temp_directory, {
      token: second_runtime_record.execution.run_id,
    });
    const final_first_runtime_record = JSON.parse(
      await readFile(first_run_result.runtime_record_path, 'utf8'),
    );
    const final_second_runtime_record = JSON.parse(
      await readFile(second_run_result.runtime_record_path, 'utf8'),
    );

    expect(approve_result).toMatchObject({
      outcome: 'success',
      task_id: 'second-runtime-slice',
    });
    expect(final_first_runtime_record.local_outcome.state).toBe('unresolved');
    expect(final_first_runtime_record.signals).toEqual([]);
    expect(final_second_runtime_record.local_outcome.state).toBe('success');
    expect(final_second_runtime_record.signals).toMatchObject([
      {
        kind: 'approval_granted',
        payload: {
          run_id: second_runtime_record.execution.run_id,
          task_id: 'task:second-runtime-slice',
        },
      },
    ]);
    expect(
      await readFile(join(second_run_result.worktree_path, 'runs.log'), 'utf8'),
    ).toBe('entered\nentered\n');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @param {string} task_id
 * @param {string} task_path
 * @returns {Promise<Awaited<ReturnType<typeof runTaskAttempt>>>}
 */
function runPendingApprovalAttempt(temp_directory, task_id, task_path) {
  return runTaskAttempt(temp_directory, {
    await_query:
      '$class == $signal and kind == approval_granted and subject == task',
    contract_path: CONTRACT_PATH,
    flow_path: FLOW_PATH,
    ordered_steps: [
      {
        kind: 'uses',
        step_name: 'local/request-approval',
      },
    ],
    runtime_label: 'Plugin runtime slice',
    task_id,
    task_path,
    transition_targets: {
      failure: 'blocked',
      success: 'review',
    },
    worktree_policy: {
      mode: 'ephemeral',
    },
  });
}

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
