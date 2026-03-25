import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from './reconcile.fixture-test-helpers.js';
import { loadSupportedJob } from './reconcile-flow.js';

it('loads the supported reconciler job shape', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).resolves.toEqual({
      select_role: 'task',
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with multiple jobs', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  first:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
      '  second:',
      '    select:',
      '      role: task',
      '    steps: []',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected docs/flows/runtime/single-task-flow-reconciler.md to define exactly one job.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with an unsupported uses step', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/not-supported',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported uses step "core/not-supported"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow without an await step', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Missing required await step',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow without every required uses step', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Missing required uses step "core/setup-worktree"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow without both outcome transitions', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected docs/flows/runtime/single-task-flow-reconciler.md to define success and failure transitions.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with an unsupported transition condition', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == maybe',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported transition condition',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with a non-object step entry', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - invalid-step',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected docs/flows/runtime/single-task-flow-reconciler.md steps to be objects.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with a malformed transition target', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - if: outcome == success',
      '        transition:',
      '          to: 1',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected transition.to to be a string',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with an unsupported step shape', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: worker_completed',
      '      - run: echo nope',
      '      - if: outcome == success',
      '        transition:',
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported reconciler step shape',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces invalid YAML flow diagnostics', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: [
      '---',
      'Kind: flow',
      'Id: single-task-flow-reconciler',
      'Status: proposed',
      '---',
      '',
      '# Broken Flow',
      '',
      '```yaml',
      'jobs: [',
      '```',
      '',
    ].join('\n'),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Invalid YAML flow definition',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowDocumentText(yaml_lines) {
  return [
    '---',
    'Kind: flow',
    'Id: single-task-flow-reconciler',
    'Status: proposed',
    '---',
    '',
    '# Single-Task Flow Reconciler',
    '',
    '```yaml',
    'kind: flow',
    'id: single-task-flow-reconciler',
    'status: proposed',
    'scope: contract',
    '',
    ...yaml_lines,
    '```',
    '',
  ].join('\n');
}
