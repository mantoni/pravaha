// @module-tag lint-staged-excluded

/* eslint-disable max-lines, max-lines-per-function */
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
      await_query:
        '$class = $signal and kind = worker_completed and subject = task',
      select_query: '$class == task and tracked_in == @document',
      select_role: 'task',
      worktree_policy: {
        mode: 'ephemeral',
      },
      transition_conditions: {
        failure:
          '$class = $signal and kind = worker_completed and subject = task and outcome = failure',
        success:
          '$class = $signal and kind = worker_completed and subject = task and outcome = success',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'task',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads a mixed-graph reconciler flow with query select and explicit transition targets', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: named',
      '      slot: castello',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: document',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).resolves.toEqual({
      await_query:
        '$class = $signal and kind = worker_completed and subject = task',
      select_query:
        '$class = task and tracked_in = @document and status = ready',
      select_role: 'task',
      worktree_policy: {
        mode: 'named',
        slot: 'castello',
      },
      transition_conditions: {
        failure:
          '$class = $signal and kind = worker_completed and subject = task and outcome = failure',
        success:
          '$class = $signal and kind = worker_completed and subject = task and outcome = success',
      },
      transition_target_bindings: {
        failure: 'task',
        success: 'document',
      },
      transition_targets: {
        failure: 'blocked',
        success: 'review',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow without a supported job-level worktree policy', async () => {
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
      '          to: review',
      '      - if: outcome == failure',
      '        transition:',
      '          to: blocked',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected docs/flows/runtime/single-task-flow-reconciler.md to define a supported job-level worktree policy.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with a step-level worktree override', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '        worktree:',
      '          mode: named',
      '          slot: castello',
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
      'Step-level worktree overrides are not supported',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with a named worktree that omits the exact slot', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    worktree:',
      '      mode: named',
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
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Named worktree policy must define a non-empty slot',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with an unsupported worktree mode', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: task',
      '    worktree:',
      '      mode: pooled',
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
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported worktree mode "pooled"',
    );
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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

it('rejects a reconciler flow with an unsupported select role', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select:',
      '      role: contract',
      '    worktree:',
      '      mode: ephemeral',
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
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported select role "contract"',
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
      '    worktree:',
      '      mode: ephemeral',
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

it('rejects a reconciler flow with an invalid select shape', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: 1',
      '    worktree:',
      '      mode: ephemeral',
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
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Expected docs/flows/runtime/single-task-flow-reconciler.md to define a supported select query or select.role value.',
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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
      '    worktree:',
      '      mode: ephemeral',
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
      'Expected transition.status to be a string',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow that selects runtime classes directly', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == $signal',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: $class == $signal and kind == worker_completed',
      '      - if: $class == $signal and outcome == success',
      '        transition:',
      '          status: review',
      '          target: task',
      '      - if: $class == $signal and outcome == failure',
      '        transition:',
      '          status: blocked',
      '          target: task',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Reserved runtime classes are not allowed in select queries',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a reconciler flow with an unsupported explicit transition target', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == task and tracked_in == @document',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await: $class == $signal and kind == worker_completed',
      '      - if: $class == $signal and outcome == success',
      '        transition:',
      '          status: review',
      '          target: worker',
      '      - if: $class == $signal and outcome == failure',
      '        transition:',
      '          status: blocked',
      '          target: task',
    ]),
  });

  try {
    await expect(loadSupportedJob(temp_directory, FLOW_PATH)).rejects.toThrow(
      'Unsupported transition target "worker"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('keeps literal task values unchanged in executable flow queries', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocumentText([
      'jobs:',
      '  reconcile_first_ready_task:',
      '    select: $class == task and tracked_in == @document and status == ready',
      '    worktree:',
      '      mode: ephemeral',
      '    steps:',
      '      - uses: core/lease-task',
      '      - uses: core/setup-worktree',
      '      - uses: core/codex-sdk',
      '      - await:',
      '          $class == $signal and kind == worker_completed and subject == task',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == success',
      '        transition:',
      '          target: task',
      '          status: review',
      '      - if:',
      '          $class == $signal and kind == worker_completed and subject == task and outcome == failure',
      '        transition:',
      '          target: task',
      '          status: blocked',
    ]),
  });

  try {
    await expect(
      loadSupportedJob(temp_directory, FLOW_PATH),
    ).resolves.toMatchObject({
      await_query:
        '$class = $signal and kind = worker_completed and subject = task',
      select_query:
        '$class = task and tracked_in = @document and status = ready',
      transition_conditions: {
        failure:
          '$class = $signal and kind = worker_completed and subject = task and outcome = failure',
        success:
          '$class = $signal and kind = worker_completed and subject = task and outcome = success',
      },
    });
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
      '    worktree:',
      '      mode: ephemeral',
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
