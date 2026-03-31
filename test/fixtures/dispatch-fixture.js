/* eslint-disable max-lines-per-function */
import {
  createFixtureDocument,
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from './runtime-fixture.js';

const APPROVAL_CONTRACT_PATH = 'docs/contracts/runtime/approval-contract.md';
const APPROVAL_FLOW_PATH = 'docs/flows/runtime/approval-flow.js';
const CONFLICTING_CONTRACT_PATH =
  'docs/contracts/runtime/conflicting-contract.md';
const CONFLICTING_FLOW_PATH = 'docs/flows/runtime/conflicting-flow.js';
const INDEPENDENT_CONTRACT_PATH =
  'docs/contracts/runtime/independent-contract.md';
const INDEPENDENT_FLOW_PATH = 'docs/flows/runtime/independent-flow.js';

export {
  APPROVAL_CONTRACT_PATH,
  APPROVAL_FLOW_PATH,
  CONFLICTING_CONTRACT_PATH,
  CONFLICTING_FLOW_PATH,
  createReusableWorktreeFixtureRepo,
  INDEPENDENT_CONTRACT_PATH,
  INDEPENDENT_FLOW_PATH,
};

/**
 * @returns {Promise<string>}
 */
async function createReusableWorktreeFixtureRepo() {
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-pooled-worktree-',
    {
      'docs/contracts/runtime/approval-contract.md':
        createContractFixture('approval-contract'),
      'docs/contracts/runtime/conflicting-contract.md': createContractFixture(
        'conflicting-contract',
      ),
      'docs/contracts/runtime/independent-contract.md': createContractFixture(
        'independent-contract',
      ),
      'docs/decisions/runtime/trigger-driven-codex-runtime.md':
        createDecisionFixtureDocument('trigger-driven-codex-runtime'),
      [APPROVAL_FLOW_PATH]: createPooledDispatchFlowModuleSource(
        'approval-flow',
        'app',
      ),
      [CONFLICTING_FLOW_PATH]: createPooledDispatchFlowModuleSource(
        'conflicting-flow',
        'app',
      ),
      [INDEPENDENT_FLOW_PATH]: createPooledDispatchFlowModuleSource(
        'independent-flow',
        'review',
      ),
      'docs/tasks/runtime/approval-task.md': createTaskFixtureDocument(
        'approval-task',
        APPROVAL_CONTRACT_PATH,
      ),
      'docs/tasks/runtime/conflicting-task.md': createTaskFixtureDocument(
        'conflicting-task',
        CONFLICTING_CONTRACT_PATH,
      ),
      'docs/tasks/runtime/independent-task.md': createTaskFixtureDocument(
        'independent-task',
        INDEPENDENT_CONTRACT_PATH,
      ),
      'docs/plans/repo/v0.1/pravaha-flow-runtime.md': createFixtureDocument({
        body: '# Runtime Plan\n',
        metadata: [
          ['Kind', 'plan'],
          ['Id', 'pravaha-flow-runtime'],
          ['Status', 'active'],
        ],
      }),
    },
    {
      pravaha_config_override: {
        workspaces: {
          app: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/abbott', '.pravaha/worktrees/castello'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          review: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/review'],
            ref: 'review',
            source: {
              kind: 'repo',
            },
          },
        },
        flows: [
          APPROVAL_FLOW_PATH,
          CONFLICTING_FLOW_PATH,
          INDEPENDENT_FLOW_PATH,
        ],
      },
    },
  );

  await linkPravahaPackage(repo_directory);

  return repo_directory;
}

/**
 * @param {string} contract_id
 * @returns {string}
 */
function createContractFixture(contract_id) {
  return createFixtureDocument({
    body: `# ${contract_id}\n`,
    metadata: [
      ['Kind', 'contract'],
      ['Id', contract_id],
      ['Status', 'proposed'],
      ['Decided by', 'docs/decisions/runtime/trigger-driven-codex-runtime.md'],
    ],
  });
}

/**
 * @param {string} decision_id
 * @returns {string}
 */
function createDecisionFixtureDocument(decision_id) {
  return createFixtureDocument({
    body: `# ${decision_id}\n`,
    metadata: [
      ['Kind', 'decision'],
      ['Id', decision_id],
      ['Status', 'accepted'],
      ['Tracked in', 'docs/plans/repo/v0.1/pravaha-flow-runtime.md'],
    ],
  });
}

/**
 * @param {string} task_id
 * @param {string} contract_path
 * @returns {string}
 */
function createTaskFixtureDocument(task_id, contract_path) {
  return createFixtureDocument({
    body: `# ${task_id}\n`,
    metadata: [
      ['Kind', 'task'],
      ['Id', task_id],
      ['Status', 'ready'],
      ['Tracked in', contract_path],
    ],
  });
}

/**
 * @param {string} flow_id
 * @param {string} workspace_id
 * @returns {string}
 */
function createPooledDispatchFlowModuleSource(flow_id, workspace_id) {
  return [
    "import { defineFlow, run } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    `    patram: '$class == task and tracked_in == contract:${flow_id.replace(/-flow$/u, '-contract')} and status == ready',`,
    '  },',
    `  workspace: '${workspace_id}',`,
    '  async main(ctx) {',
    "    await run(ctx, { command: 'true' });",
    '  },',
    '});',
    '',
  ].join('\n');
}
