import {
  createFixtureDocument,
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from './runtime-fixture.js';

const CONTRACT_PATH = 'docs/contracts/runtime/single-task-flow-reconciler.md';
const FLOW_PATH = 'docs/flows/runtime/single-task-flow-reconciler.js';

export {
  CONTRACT_PATH,
  FLOW_PATH,
  createReconcilerFixtureRepo,
  createTaskFixture,
};

/**
 * @param {{
 *   contract_status?: string,
 *   decision_documents?: Array<{ id: string, path: string, status: string }>,
 *   flow_module_source?: string,
 *   task_documents?: Array<{
 *     decided_by?: string[],
 *     depends_on?: string[],
 *     id: string,
 *     path: string,
 *     status: string,
 *   }>,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createReconcilerFixtureRepo(options = {}) {
  const fixture_files = createFixtureFiles(options);
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-reconcile-',
    fixture_files,
    {
      pravaha_config_override: {
        flows: [FLOW_PATH],
        workspaces: {
          app: {
            base_path: '.pravaha/worktrees/app',
            mode: 'ephemeral',
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          'queue-validation': {
            base_path: '.pravaha/worktrees/queue-validation',
            mode: 'ephemeral',
            ref: 'refs/pravaha/queue-validation/current',
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
 * @param {{
 *   contract_status?: string,
 *   decision_documents?: Array<{ id: string, path: string, status: string }>,
 *   flow_module_source?: string,
 *   task_documents?: Array<{
 *     decided_by?: string[],
 *     depends_on?: string[],
 *     id: string,
 *     path: string,
 *     status: string,
 *   }>,
 * }} options
 * @returns {Record<string, string>}
 */
function createFixtureFiles(options) {
  const decision_documents = options.decision_documents ?? [
    createDecisionFixture('trigger-driven-codex-runtime', 'accepted'),
  ];
  const task_documents = options.task_documents ?? [
    createTaskFixture('implement-runtime-slice', 'ready'),
  ];
  const flow_module_source =
    options.flow_module_source ?? createFlowModuleSource();

  return {
    ...createDecisionFiles(decision_documents),
    ...createTaskFiles(task_documents),
    [CONTRACT_PATH]: createContractDocument(
      options.contract_status ?? 'proposed',
      decision_documents.map((decision_document) => decision_document.path),
    ),
    [FLOW_PATH]: flow_module_source,
    'docs/plans/repo/v0.1/pravaha-flow-runtime.md': createFixtureDocument({
      body: '# Runtime Plan\n',
      metadata: [
        ['Kind', 'plan'],
        ['Id', 'pravaha-flow-runtime'],
        ['Status', 'active'],
      ],
    }),
  };
}

/**
 * @param {string} status
 * @param {string[]} decision_paths
 * @returns {string}
 */
function createContractDocument(status, decision_paths) {
  /** @type {Array<[string, string]>} */
  const metadata = [
    ['Kind', 'contract'],
    ['Id', 'single-task-flow-reconciler'],
    ['Status', status],
  ];
  const [decision_path] = decision_paths;

  if (typeof decision_path === 'string') {
    metadata.push(['Decided by', decision_path]);
  }

  return createFixtureDocument({
    body: '# Single-Task Flow Reconciler\n',
    metadata,
  });
}

/**
 * @param {Array<{ id: string, path: string, status: string }>} decision_documents
 * @returns {Record<string, string>}
 */
function createDecisionFiles(decision_documents) {
  return Object.fromEntries(
    decision_documents.map((decision_document) => [
      decision_document.path,
      createFixtureDocument({
        body: `# ${decision_document.id}\n`,
        metadata: [
          ['Kind', 'decision'],
          ['Id', decision_document.id],
          ['Status', decision_document.status],
          ['Tracked in', 'docs/plans/repo/v0.1/pravaha-flow-runtime.md'],
        ],
      }),
    ]),
  );
}

/**
 * @param {Array<{
 *   decided_by?: string[],
 *   depends_on?: string[],
 *   id: string,
 *   path: string,
 *   status: string,
 * }>} task_documents
 * @returns {Record<string, string>}
 */
function createTaskFiles(task_documents) {
  return Object.fromEntries(
    task_documents.map((task_document) => [
      task_document.path,
      createTaskDocument(task_document),
    ]),
  );
}

/**
 * @param {{
 *   decided_by?: string[],
 *   depends_on?: string[],
 *   id: string,
 *   path: string,
 *   status: string,
 * }} task_document
 * @returns {string}
 */
function createTaskDocument(task_document) {
  /** @type {Array<[string, string]>} */
  const metadata = [
    ['Kind', 'task'],
    ['Id', task_document.id],
    ['Status', task_document.status],
    ['Tracked in', CONTRACT_PATH],
  ];

  for (const dependency_path of task_document.depends_on ?? []) {
    metadata.push(['Depends on', dependency_path]);
  }

  for (const decision_path of task_document.decided_by ?? []) {
    metadata.push(['Decided by', decision_path]);
  }

  return createFixtureDocument({
    body: `# ${task_document.id}\n`,
    metadata,
  });
}

/**
 * @returns {string}
 */
function createFlowModuleSource() {
  return [
    "import { defineFlow, runCodex } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    "  workspace: 'app',",
    '  async main(ctx) {',
    '    await runCodex(ctx, {',
    "      prompt: `Implement ${ctx.bindings.doc?.path ?? 'unknown'}.`,",
    "      reasoning: 'medium',",
    '    });',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {string} id
 * @param {string} status
 * @param {{
 *   path?: string,
 * }} [options]
 * @returns {{ id: string, path: string, status: string }}
 */
function createDecisionFixture(id, status, options = {}) {
  return {
    id,
    path: options.path ?? `docs/decisions/runtime/${id}.md`,
    status,
  };
}

/**
 * @param {string} id
 * @param {string} status
 * @param {{
 *   decided_by?: string[],
 *   depends_on?: string[],
 *   path?: string,
 * }} [options]
 * @returns {{
 *   decided_by?: string[],
 *   depends_on?: string[],
 *   id: string,
 *   path: string,
 *   status: string,
 * }}
 */
function createTaskFixture(id, status, options = {}) {
  return {
    decided_by: options.decided_by,
    depends_on: options.depends_on,
    id,
    path: options.path ?? `docs/tasks/runtime/${id}.md`,
    status,
  };
}
