import { createFixtureDocument } from './run-happy-path.fixture-test-helpers.js';
import { createReconcilerFixtureRepo } from './reconcile.fixture-test-helpers.js';

export { createStateMachineFixtureRepo, createStateMachinePreamble };

/**
 * @param {{
 *   yaml_lines?: string[],
 * } | string[]} [options]
 * @returns {Promise<string>}
 */
async function createStateMachineFixtureRepo(options = {}) {
  const yaml_lines = Array.isArray(options)
    ? options
    : (options.yaml_lines ?? createDefaultStateMachineYamlLines());

  return createReconcilerFixtureRepo({
    flow_document_text: createFixtureDocument({
      body: [
        '# State Machine Flow',
        '',
        '```yaml',
        ...yaml_lines,
        '```',
        '',
      ].join('\n'),
      metadata: /** @type {Array<[string, string]>} */ ([
        ['Kind', 'flow'],
        ['Id', 'single-task-flow-reconciler'],
        ['Status', 'proposed'],
      ]),
    }),
  });
}

/**
 * @returns {string[]}
 */
function createStateMachinePreamble() {
  return [
    'kind: flow',
    'id: single-task-flow-reconciler',
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
    '    mode: ephemeral',
    '    ref: main',
    '',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    '',
    'jobs:',
  ];
}

/**
 * @returns {string[]}
 */
function createDefaultStateMachineYamlLines() {
  return [
    ...createStateMachinePreamble(),
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement ${{ task.path }}.',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}
