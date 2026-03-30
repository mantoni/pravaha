/* eslint-disable max-lines, max-lines-per-function */
// @module-tag lint-staged-excluded

import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from '../../test/fixtures/reconcile-fixture.js';
import { loadExecutableDispatchFlow } from './reconcile-flow.js';

it('loads the checked-in dispatch flow through the executable wrapper', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).resolves.toMatchObject({
      flow: {
        ordered_jobs: /** @type {unknown} */ (expect.any(Array)),
        start_job_name: 'implement',
        trigger: {
          owner_class: 'task',
        },
        workspace: {
          type: 'git.workspace',
        },
      },
      surface: 'state-machine',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects malformed trigger queries', async () => {
  const reserved_binding_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  document: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });
  const malformed_where_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: [ready]',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(reserved_binding_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define flow.on.patram as a string.`,
    );
    await expect(
      loadExecutableDispatchFlow(malformed_where_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define flow.on.patram as a string.`,
    );
  } finally {
    await rm(reserved_binding_repo, { force: true, recursive: true });
    await rm(malformed_where_repo, { force: true, recursive: true });
  }
});

it('rejects invalid plugin with-values during flow interpretation', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  implement:',
      '    uses: core/run-codex',
      '    with:',
      '      prompt: Implement it.',
      '      reasoning: 1',
      '    next: done',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `reasoning: Invalid option: expected one of "low"|"medium"|"high" in ${FLOW_PATH}.`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects malformed workspace shapes during flow interpretation', async () => {
  const invalid_type_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: bad.workspace',
      '  source:',
      '    kind: repo',
      '    id: app',
      '  materialize:',
      '    kind: worktree',
      '    mode: ephemeral',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });
  const invalid_materialize_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '    kind: checkout',
      '    mode: ephemeral',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(invalid_type_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.type to be "git.workspace".`,
    );
    await expect(
      loadExecutableDispatchFlow(invalid_materialize_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.materialize.kind to be "worktree".`,
    );
  } finally {
    await rm(invalid_type_repo, { force: true, recursive: true });
    await rm(invalid_materialize_repo, { force: true, recursive: true });
  }
});

it('loads pooled workspace ids during flow interpretation', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    ids:',
      '      - app',
      '      - app-1',
      '  materialize:',
      '    kind: worktree',
      '    mode: pooled',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).resolves.toMatchObject({
      flow: {
        workspace: {
          source: {
            ids: ['app', 'app-1'],
          },
        },
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects malformed workspace source id declarations during flow interpretation', async () => {
  const mixed_ids_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '    ids:',
      '      - app-1',
      '  materialize:',
      '    kind: worktree',
      '    mode: pooled',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });
  const empty_ids_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    ids: []',
      '  materialize:',
      '    kind: worktree',
      '    mode: pooled',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });
  const blank_entry_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    ids:',
      '      - app',
      '      - ""',
      '  materialize:',
      '    kind: worktree',
      '    mode: pooled',
      '    ref: main',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(mixed_ids_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.source to declare exactly one of id or ids.`,
    );
    await expect(
      loadExecutableDispatchFlow(empty_ids_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.source.id to be a non-empty string or workspace.source.ids to be a non-empty array of unique strings.`,
    );
    await expect(
      loadExecutableDispatchFlow(blank_entry_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.source.id to be a non-empty string or workspace.source.ids to be a non-empty array of unique strings.`,
    );
  } finally {
    await rm(mixed_ids_repo, { force: true, recursive: true });
    await rm(empty_ids_repo, { force: true, recursive: true });
    await rm(blank_entry_repo, { force: true, recursive: true });
  }
});

it('rejects missing jobs, empty jobs, and malformed state-machine jobs', async () => {
  const missing_jobs_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
    ]),
  });
  const empty_jobs_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs: {}',
    ]),
  });
  const malformed_job_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  implement: nope',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(missing_jobs_repo, FLOW_PATH),
    ).rejects.toThrow(
      `${FLOW_PATH}: Flow YAML must define a top-level "jobs" mapping.`,
    );
    await expect(
      loadExecutableDispatchFlow(empty_jobs_repo, FLOW_PATH),
    ).rejects.toThrow(`Expected ${FLOW_PATH} to define at least one job.`);
    await expect(
      loadExecutableDispatchFlow(malformed_job_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define one supported state-machine job object.`,
    );
  } finally {
    await rm(missing_jobs_repo, { force: true, recursive: true });
    await rm(empty_jobs_repo, { force: true, recursive: true });
    await rm(malformed_job_repo, { force: true, recursive: true });
  }
});

it('rejects malformed action jobs, next branches, and trigger shapes', async () => {
  const missing_uses_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  implement:',
      '    next: done',
      '  done:',
      '    end: success',
    ]),
  });
  const unsupported_plugin_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  implement:',
      '    uses: core/missing',
      '    next: done',
      '  done:',
      '    end: success',
    ]),
  });
  const malformed_next_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  implement:',
      '    uses: core/run',
      '    with:',
      '      command: true',
      '    next:',
      '      - goto: done',
      '      - goto: done',
      '  done:',
      '    end: success',
    ]),
  });
  const invalid_workspace_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'status: proposed',
      'scope: contract',
      '',
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    id: ""',
      '  materialize:',
      '    kind: worktree',
      '    mode: invalid',
      '    ref: ""',
      '',
      'on:',
      '  patram: $class == task and status == ready',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });
  const multi_trigger_repo = await createReconcilerFixtureRepo({
    flow_document_text: createFlowDocument([
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
      '  patram: $class == task and status == ready',
      '  review:',
      '    where: $class == task and status == review',
      '',
      'jobs:',
      '  done:',
      '    end: success',
    ]),
  });

  try {
    await expect(
      loadExecutableDispatchFlow(missing_uses_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} action jobs to define a non-empty uses value.`,
    );
    await expect(
      loadExecutableDispatchFlow(unsupported_plugin_repo, FLOW_PATH),
    ).rejects.toThrow('Unsupported uses step "core/missing".');
    await expect(
      loadExecutableDispatchFlow(malformed_next_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected only the final next branch in ${FLOW_PATH} to omit if.`,
    );
    await expect(
      loadExecutableDispatchFlow(invalid_workspace_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace.source.id to be a non-empty string.`,
    );
    await expect(
      loadExecutableDispatchFlow(multi_trigger_repo, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define flow.on.patram as a string.`,
    );
  } finally {
    await rm(missing_uses_repo, { force: true, recursive: true });
    await rm(unsupported_plugin_repo, { force: true, recursive: true });
    await rm(malformed_next_repo, { force: true, recursive: true });
    await rm(invalid_workspace_repo, { force: true, recursive: true });
    await rm(multi_trigger_repo, { force: true, recursive: true });
  }
});

it('formats parse diagnostics when the flow document is malformed', async () => {
  const temp_directory = await createReconcilerFixtureRepo({
    flow_document_text: '',
  });

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `${FLOW_PATH}: Flow documents must contain exactly one YAML document.`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string[]} yaml_lines
 * @returns {string}
 */
function createFlowDocument(yaml_lines) {
  return [...yaml_lines, ''].join('\n');
}
