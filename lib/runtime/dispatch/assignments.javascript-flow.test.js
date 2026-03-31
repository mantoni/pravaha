/** @import { LocalDispatchMessage } from './protocol.js' */
/* eslint-disable max-lines-per-function */
import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { materializePendingAssignments } from './assignments.js';
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

it('schedules JavaScript flow modules as dispatch assignments', async () => {
  const repo_directory = await createJavaScriptDispatchRepo({
    flow_source: createFlowSource(
      '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
    ),
    task_metadata: [['Tracked in', CONTRACT_PATH]],
  });

  try {
    const [assignment] = await readPendingAssignments(repo_directory);

    expect(assignment).toMatchObject({
      contract_path: CONTRACT_PATH,
      flow_path: FLOW_PATH,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('builds prompt context from owner decisions when no contract is tracked', async () => {
  const repo_directory = await createJavaScriptDispatchRepo({
    flow_source: createFlowSource('$class == task and status == ready'),
    task_metadata: [['Decided by', DECISION_PATH]],
  });

  try {
    await expect(readPendingAssignments(repo_directory)).resolves.toEqual([
      expect.objectContaining({
        contract_path: undefined,
        decision_paths: [DECISION_PATH],
      }),
    ]);
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   flow_source: string,
 *   task_metadata: Array<[string, string]>,
 * }} options
 * @returns {Promise<string>}
 */
async function createJavaScriptDispatchRepo(options) {
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-js-assignment-',
    {
      [DECISION_PATH]: createFixtureDocument({
        body: '# Trigger-Driven Codex Runtime\n',
        metadata: [
          ['Kind', 'decision'],
          ['Id', 'trigger-driven-codex-runtime'],
          ['Status', 'accepted'],
          ['Tracked in', PLAN_PATH],
        ],
      }),
      [FLOW_PATH]: options.flow_source,
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
          ...options.task_metadata,
        ],
      }),
      [CONTRACT_PATH]: createFixtureDocument({
        body: '# Single-Task Flow Reconciler\n',
        metadata: [
          ['Kind', 'contract'],
          ['Id', 'single-task-flow-reconciler'],
          ['Status', 'proposed'],
          ['Decided by', DECISION_PATH],
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
            base_path: '.pravaha/worktrees/app',
            mode: 'ephemeral',
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
 * @param {string} repo_directory
 * @returns {Promise<Array<Extract<LocalDispatchMessage, { type: 'assignment' }>>>}
 */
async function readPendingAssignments(repo_directory) {
  const graph_api = resolveGraphApi(undefined);

  return materializePendingAssignments({
    emit_event: async () => {},
    endpoint: 'ipc://test',
    graph_api: {
      load_project_graph: (target_repo_directory) =>
        graph_api.load_project_graph(target_repo_directory),
      query_graph: graph_api.query_graph,
    },
    log_to_operator() {},
    now: () => new Date('2026-03-30T10:00:00.000Z'),
    repo_directory,
    worker_id: 'worker:test',
  });
}

/**
 * @param {string} query_text
 * @returns {string}
 */
function createFlowSource(query_text) {
  return [
    "import { defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    `    patram: '${query_text}',`,
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
