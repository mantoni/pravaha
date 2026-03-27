// @module-tag lint-staged-excluded
/* eslint-disable max-lines */

import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { createFixtureDocument } from './run-happy-path.fixture-test-helpers.js';
import {
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { loadStateMachineFlow } from './reconcile-flow.js';

it('loads the supported state-machine flow shape', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createStateMachineFlowDocumentText(
      createValidStateMachineYamlLines(),
    ),
  });

  try {
    await expect(
      loadStateMachineFlow(temp_directory, FLOW_PATH),
    ).resolves.toEqual(createExpectedStateMachineFlow());
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects unknown next targets in state-machine flows', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createStateMachineFlowDocumentText(
      createInvalidStateMachineYamlLines(),
    ),
  });

  try {
    await expect(
      loadStateMachineFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow('Unknown next target "missing"');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects unsupported state-machine workspace shapes', async () => {
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '  type: git.workspace',
      '  type: shell.workspace',
    ),
    'workspace.type to be "git.workspace"',
  );
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '    kind: repo',
      '    kind: remote',
    ),
    'workspace.source.kind to be "repo"',
  );
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '    mode: pooled',
      '    mode: shared',
    ),
    'workspace.materialize.mode to be "ephemeral" or "pooled"',
  );
});

it('rejects unsupported state-machine next and limits definitions', async () => {
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '      max-visits: 3',
      '      max-visits: 0',
    ),
    'limits.max-visits to be a positive integer',
  );
  await expectStateMachineLoadFailure(
    createInvalidUnconditionalBranchYamlLines(),
    'only the final next branch',
  );
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createInvalidStateMachineYamlLines(),
      '    next: missing',
      '    next: {}',
    ),
    'next as a non-empty string target or branch list',
  );
  await expectStateMachineLoadFailure(
    createInvalidEmptyGotoYamlLines(),
    'next.goto values to be non-empty strings',
  );
});

it('rejects unsupported state-machine uses and end definitions', async () => {
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '    uses: core/agent',
      '    uses: ""',
    ),
    'Unsupported uses step "".',
  );
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '    end: success',
      '    end: ""',
    ),
    'end jobs to define a non-empty end state',
  );
});

it('rejects invalid plugin with values in state-machine jobs', async () => {
  await expectStateMachineLoadFailure(
    replaceYamlLine(
      createValidStateMachineYamlLines(),
      '      capture: [stdout, stderr]',
      '      capture: [stdout, invalid]',
    ),
    'Invalid option',
  );
});

it('rejects invalid state-machine trigger definitions', async () => {
  await expectStateMachineLoadFailure(
    createInvalidOnShapeYamlLines(),
    `Expected ${FLOW_PATH} to define exactly one root trigger binding.`,
  );
  await expectStateMachineLoadFailure(
    createInvalidMultipleTriggersYamlLines(),
    `Expected ${FLOW_PATH} to define exactly one root trigger binding.`,
  );
  await expectStateMachineLoadFailure(
    createInvalidTriggerBindingShapeYamlLines(),
    `Expected on.task in ${FLOW_PATH} to be an object.`,
  );
});

/**
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createStateMachineFlowDocumentText(yaml_lines) {
  return createFixtureDocument({
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
  });
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>}
 */
function createExpectedStateMachineFlow() {
  return {
    ordered_jobs: createExpectedOrderedJobs(),
    start_job_name: 'implement',
    trigger: createExpectedTrigger(),
    workspace: createExpectedWorkspace(),
  };
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs']}
 */
function createExpectedOrderedJobs() {
  return [
    createExpectedImplementJob(),
    createExpectedRetryJob(),
    createExpectedDoneJob(),
  ];
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'][number]}
 */
function createExpectedImplementJob() {
  return {
    job_name: 'implement',
    kind: 'action',
    limits: null,
    next_branches: [
      {
        condition_text: '${{ result.exit_code == 0 }}',
        target_job_name: 'done',
      },
      {
        condition_text: null,
        target_job_name: 'retry',
      },
    ],
    uses_value: 'core/agent',
    with_value: {
      prompt: 'Implement the task.',
      provider: 'codex-sdk',
    },
  };
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'][number]}
 */
function createExpectedRetryJob() {
  return {
    job_name: 'retry',
    kind: 'action',
    limits: {
      max_visits: 3,
    },
    next_branches: [
      {
        condition_text: null,
        target_job_name: 'done',
      },
    ],
    uses_value: 'core/run',
    with_value: {
      capture: ['stdout', 'stderr'],
      command: 'npm test',
    },
  };
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['ordered_jobs'][number]}
 */
function createExpectedDoneJob() {
  return {
    end_state: 'success',
    job_name: 'done',
    kind: 'end',
  };
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['trigger']}
 */
function createExpectedTrigger() {
  return {
    binding_name: 'task',
    query_text: '$class = task and tracked_in = @document and status = ready',
    role: 'task',
  };
}

/**
 * @returns {Awaited<ReturnType<typeof loadStateMachineFlow>>['workspace']}
 */
function createExpectedWorkspace() {
  return {
    materialize: {
      kind: 'worktree',
      mode: 'pooled',
      ref: 'main',
    },
    source: {
      id: 'app',
      kind: 'repo',
    },
    type: 'git.workspace',
  };
}

/**
 * @returns {string[]}
 */
function createValidStateMachineYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidStateMachineYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next: missing',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidUnconditionalBranchYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - goto: done',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidEmptyGotoYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: ""',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidMultipleTriggersYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document and status == ready',
    '  issue:',
    '    where: $class == issue and tracked_in == @document',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidOnShapeYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on: []',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @returns {string[]}
 */
function createInvalidTriggerBindingShapeYamlLines() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task: ready',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement the task.',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '      capture: [stdout, stderr]',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
  ];
}

/**
 * @param {string[]} yaml_lines
 * @param {string} expected_message
 * @returns {Promise<void>}
 */
async function expectStateMachineLoadFailure(yaml_lines, expected_message) {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createStateMachineFlowDocumentText(yaml_lines),
  });

  try {
    await expect(
      loadStateMachineFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(expected_message);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}

/**
 * @param {string[]} yaml_lines
 * @param {string} original_line
 * @param {string} replacement_line
 * @returns {string[]}
 */
function replaceYamlLine(yaml_lines, original_line, replacement_line) {
  return yaml_lines.map((yaml_line) =>
    yaml_line === original_line ? replacement_line : yaml_line,
  );
}
