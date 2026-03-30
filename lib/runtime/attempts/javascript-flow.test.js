/* eslint-disable max-lines-per-function */
import { readFile, rm } from 'node:fs/promises';
import process from 'node:process';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { approve as approve_run } from '../../approve.js';
import { runJavaScriptFlowAttempt } from './javascript-flow.js';
import {
  createFixtureDocument,
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../../test/fixtures/runtime-fixture.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const DECISION_PATH = 'docs/decisions/runtime/trigger-driven-codex-runtime.md';
const FLOW_PATH = 'docs/flows/runtime/single-task-flow-reconciler.js';
const PLAN_PATH = 'docs/plans/repo/v0.1/pravaha-flow-runtime.md';
const TASK_PATH = 'docs/tasks/runtime/implement-runtime-slice.md';

it('executes JavaScript flow modules with ctx state, runtime fields, and imported run()', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createRuntimeContextFlowSource(),
  );

  try {
    const run_result = await runJavaScriptFlowAttempt(repo_directory, {
      binding_targets: {
        document: {
          id: 'document:runtime-context',
          path: 'docs/contracts/runtime/runtime-context.md',
          status: 'active',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow runtime test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });
    const runtime_record = await readRuntimeRecord(
      run_result.runtime_record_path,
    );
    const context_value = await readJsonFile(
      join(run_result.worktree_path, 'context.json'),
    );

    expect(run_result.outcome).toBe('success');
    expect(
      await readFile(join(run_result.worktree_path, 'runtime.txt'), 'utf8'),
    ).toBe('ready');
    expect(context_value).toEqual({
      contract_path: CONTRACT_PATH,
      document_path: 'docs/contracts/runtime/runtime-context.md',
      flow_path: FLOW_PATH,
      repo_directory,
      run_id: asMatcher(
        expect.stringContaining('run:implement-runtime-slice:'),
      ),
      task_path: TASK_PATH,
    });
    expect(runtime_record.format_version).toBe('javascript-flow-v1');
    expect(runtime_record.flow_state).toEqual({
      current_handler_name: 'main',
      durable_state: {
        phase: 'planned',
      },
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails JavaScript flow modules when imported run() exits non-zero', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createRunFailureFlowSource(),
  );

  try {
    const run_result = await runJavaScriptFlowAttempt(repo_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow run failure test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toBe('stderr boom');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('persists approval waits and wait payloads for JavaScript flow modules', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createApprovalFlowSource(),
  );

  try {
    const run_result = await runJavaScriptFlowAttempt(repo_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow approval test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });
    const runtime_record = await readRuntimeRecord(
      run_result.runtime_record_path,
    );

    expect(run_result.outcome).toBe('pending-approval');
    expect(runtime_record.approval).toEqual({
      approved_at: null,
      requested_at: asMatcher(expect.any(String)),
    });
    expect(runtime_record.flow_state).toEqual({
      current_handler_name: 'main',
      durable_state: {
        phase: 'awaiting-review',
      },
      wait_state: {
        data: {
          approved_prompt: 'Ship it',
        },
        handler_name: 'onApprove',
        kind: 'approval',
      },
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails JavaScript flow modules that call approve(ctx, with) without onApprove', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createMissingOnApproveFlowSource(),
  );

  try {
    const run_result = await runJavaScriptFlowAttempt(repo_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow missing onApprove test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain('must export onApprove');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('re-enters JavaScript flow modules through onApprove after approval', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createApprovalFlowSource(),
  );

  try {
    const initial_result = await runJavaScriptFlowAttempt(repo_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow approval resume test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });
    const runtime_record = await readRuntimeRecord(
      initial_result.runtime_record_path,
    );
    const resumed_result = await approve_run(repo_directory, {
      token: readExecutionRunId(runtime_record),
    });
    const final_runtime_record = await readRuntimeRecord(
      resumed_result.runtime_record_path,
    );

    expect(resumed_result.outcome).toBe('success');
    expect(
      await readJsonFile(join(resumed_result.worktree_path, 'approved.json')),
    ).toEqual({
      phase: 'awaiting-review',
      prompt: 'Ship it',
    });
    expect(final_runtime_record.flow_state).toEqual({
      current_handler_name: 'onApprove',
      durable_state: {
        phase: 'awaiting-review',
      },
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('fails JavaScript flow modules when imported runCodex() fails', async () => {
  const repo_directory = await createJavaScriptFixtureRepo(
    createRunCodexFailureFlowSource(),
  );
  const previous_codex_bin = process.env.PRAVAHA_CODEX_BIN;

  try {
    process.env.PRAVAHA_CODEX_BIN = join(repo_directory, 'missing-codex');

    const run_result = await runJavaScriptFlowAttempt(repo_directory, {
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
      runtime_label: 'JavaScript flow runCodex failure test',
      task_id: 'implement-runtime-slice',
      task_path: TASK_PATH,
      workspace: {
        id: 'app',
      },
    });

    expect(run_result.outcome).toBe('failure');
    expect(run_result.worker_error).toContain('missing-codex');
  } finally {
    restoreEnvironmentVariable('PRAVAHA_CODEX_BIN', previous_codex_bin);
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} flow_source
 * @returns {Promise<string>}
 */
async function createJavaScriptFixtureRepo(flow_source) {
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-js-flow-',
    {
      [CONTRACT_PATH]: createFixtureDocument({
        body: '# Single-Task Flow Reconciler\n',
        metadata: [
          ['Kind', 'contract'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
          ['Decided by', DECISION_PATH],
        ],
      }),
      [DECISION_PATH]: createFixtureDocument({
        body: '# Trigger-Driven Codex Runtime\n',
        metadata: [
          ['Kind', 'decision'],
          ['Id', 'trigger-driven-codex-runtime'],
          ['Status', 'accepted'],
          ['Tracked in', PLAN_PATH],
        ],
      }),
      [FLOW_PATH]: flow_source,
      [PLAN_PATH]: createFixtureDocument({
        body: '# Runtime Plan\n',
        metadata: [
          ['Kind', 'plan'],
          ['Id', 'pravaha-flow-runtime'],
          ['Status', 'active'],
        ],
      }),
      [TASK_PATH]: createFixtureDocument({
        body: '# Implement Runtime Slice\n',
        metadata: [
          ['Kind', 'task'],
          ['Id', 'implement-runtime-slice'],
          ['Status', 'ready'],
          ['Tracked in', CONTRACT_PATH],
        ],
      }),
    },
    {
      pravaha_config_override: {
        flows: {
          default_matches: [FLOW_PATH],
        },
        workspaces: {
          app: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/app'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
        },
      },
    },
  );

  await linkPravahaPackage(repo_directory);

  return repo_directory;
}

/**
 * @returns {string}
 */
function createRuntimeContextFlowSource() {
  return [
    "import { defineFlow, run } from 'pravaha';",
    "import { writeFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await run(ctx, { command: 'printf ready > runtime.txt' });",
    "    await ctx.setState({ phase: 'planned' });",
    "    await writeFile(join(ctx.worktree_path, 'context.json'), JSON.stringify({",
    '      contract_path: ctx.contract_path,',
    '      document_path: ctx.document?.path ?? null,',
    '      flow_path: ctx.flow_path,',
    '      repo_directory: ctx.repo_directory,',
    '      run_id: ctx.run_id,',
    '      task_path: ctx.task_path,',
    '    }));',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createApprovalFlowSource() {
  return [
    "import { approve, defineFlow } from 'pravaha';",
    "import { writeFile } from 'node:fs/promises';",
    "import { join } from 'node:path';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await ctx.setState({ phase: 'awaiting-review' });",
    '    await approve(ctx, {',
    "      data: { approved_prompt: 'Ship it' },",
    "      title: 'Review implementation',",
    '    });',
    '  },',
    '  async onApprove(ctx, data) {',
    "    await writeFile(join(ctx.worktree_path, 'approved.json'), JSON.stringify({",
    '      phase: ctx.state.phase,',
    '      prompt: data.approved_prompt,',
    '    }));',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createMissingOnApproveFlowSource() {
  return [
    "import { approve, defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await approve(ctx, { title: 'Review implementation' });",
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createRunFailureFlowSource() {
  return [
    "import { defineFlow, run } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    `    await run(ctx, { capture: ['stderr'], command: 'printf "stderr boom" >&2; exit 2' });`,
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createRunCodexFailureFlowSource() {
  return [
    "import { defineFlow, runCodex } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    "    await runCodex(ctx, { prompt: 'Implement the task.' });",
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {string} runtime_record_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readRuntimeRecord(runtime_record_path) {
  return readJsonFile(runtime_record_path);
}

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}

/**
 * @param {string} file_path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonFile(file_path) {
  const parsed_value = /** @type {unknown} */ (
    JSON.parse(await readFile(file_path, 'utf8'))
  );

  if (
    parsed_value === null ||
    typeof parsed_value !== 'object' ||
    Array.isArray(parsed_value)
  ) {
    throw new Error(`Expected ${file_path} to contain a JSON object.`);
  }

  return /** @type {Record<string, unknown>} */ (parsed_value);
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string}
 */
function readExecutionRunId(runtime_record) {
  const execution = /** @type {Record<string, unknown> | null} */ (
    runtime_record.execution !== null &&
    typeof runtime_record.execution === 'object' &&
    !Array.isArray(runtime_record.execution)
      ? runtime_record.execution
      : null
  );

  if (execution === null || typeof execution.run_id !== 'string') {
    throw new Error('Expected runtime record to contain execution.run_id.');
  }

  return execution.run_id;
}

/**
 * @param {string} name
 * @param {string | undefined} value
 * @returns {void}
 */
function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
