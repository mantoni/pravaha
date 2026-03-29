import {
  createFixtureDocument,
  createFixtureRepoFromFiles,
} from './runtime-fixture.js';

const APPROVAL_CONTRACT_PATH = 'docs/contracts/runtime/approval-contract.md';
const APPROVAL_FLOW_PATH = 'docs/flows/runtime/approval-flow.yaml';
const CONFLICTING_CONTRACT_PATH =
  'docs/contracts/runtime/conflicting-contract.md';
const CONFLICTING_FLOW_PATH = 'docs/flows/runtime/conflicting-flow.yaml';
const INDEPENDENT_CONTRACT_PATH =
  'docs/contracts/runtime/independent-contract.md';
const INDEPENDENT_FLOW_PATH = 'docs/flows/runtime/independent-flow.yaml';

export {
  APPROVAL_CONTRACT_PATH,
  APPROVAL_FLOW_PATH,
  createReusableWorktreeFixtureRepo,
  INDEPENDENT_CONTRACT_PATH,
  INDEPENDENT_FLOW_PATH,
};

/**
 * @returns {Promise<string>}
 */
async function createReusableWorktreeFixtureRepo() {
  return createFixtureRepoFromFiles('pravaha-pooled-worktree-', {
    'docs/contracts/runtime/approval-contract.md': createContractFixture(
      'approval-contract',
      APPROVAL_FLOW_PATH,
    ),
    'docs/contracts/runtime/conflicting-contract.md': createContractFixture(
      'conflicting-contract',
      CONFLICTING_FLOW_PATH,
    ),
    'docs/contracts/runtime/independent-contract.md': createContractFixture(
      'independent-contract',
      INDEPENDENT_FLOW_PATH,
    ),
    'docs/decisions/runtime/trigger-driven-codex-runtime.md':
      createDecisionFixtureDocument('trigger-driven-codex-runtime'),
    [APPROVAL_FLOW_PATH]: createPooledDispatchFlowDocumentText(
      'approval-flow',
      'main',
    ),
    [CONFLICTING_FLOW_PATH]: createPooledDispatchFlowDocumentText(
      'conflicting-flow',
      'main',
    ),
    [INDEPENDENT_FLOW_PATH]: createPooledDispatchFlowDocumentText(
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
  });
}

/**
 * @param {string} contract_id
 * @param {string} flow_path
 * @returns {string}
 */
function createContractFixture(contract_id, flow_path) {
  return createFixtureDocument({
    body: `# ${contract_id}\n`,
    metadata: [
      ['Kind', 'contract'],
      ['Id', contract_id],
      ['Status', 'proposed'],
      ['Decided by', 'docs/decisions/runtime/trigger-driven-codex-runtime.md'],
      ['Root flow', flow_path],
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
 * @param {string} ref
 * @returns {string}
 */
function createPooledDispatchFlowDocumentText(flow_id, ref) {
  return [
    'kind: flow',
    `id: ${flow_id}`,
    'status: proposed',
    'scope: contract',
    '',
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    `    ref: ${ref}`,
    '',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    '',
    'jobs:',
    '  implement:',
    '    uses: core/run',
    '    with:',
    '      command: "true"',
    '    next: done',
    '  done:',
    '    end: success',
    '',
  ].join('\n');
}
