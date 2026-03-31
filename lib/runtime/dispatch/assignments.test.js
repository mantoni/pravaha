/* eslint-disable max-lines */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.config.js';
import {
  APPROVAL_CONTRACT_PATH,
  APPROVAL_FLOW_PATH,
  CONFLICTING_CONTRACT_PATH,
  CONFLICTING_FLOW_PATH,
  createReusableWorktreeFixtureRepo,
  INDEPENDENT_CONTRACT_PATH,
  INDEPENDENT_FLOW_PATH,
} from '../../../test/fixtures/dispatch-fixture.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from '../../../test/fixtures/reconcile-fixture.js';
import {
  createFixtureDocument,
  createPravahaConfigSource,
} from '../../../test/fixtures/runtime-fixture.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { materializePendingAssignments } from './assignments.js';

it('schedules configured flow matches globally', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writePravahaConfig(temp_directory, {
      flows: ['docs/flows/runtime/default-fallback.js'],
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback.js',
      createDispatchFlowModuleSource(
        '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contract_path: CONTRACT_PATH,
          flow_path: 'docs/flows/runtime/default-fallback.js',
        }),
      ]),
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('leaves tasks unscheduled when no fallback flow matches', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writeContractDocument(temp_directory);
    await writePravahaConfig(temp_directory, {
      flows: ['docs/flows/runtime/no-match.js'],
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/no-match.js',
      createDispatchFlowModuleSource(
        '$class == task and tracked_in == contract:single-task-flow-reconciler and status == review',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('schedules one configured flow when exactly one candidate matches', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writeContractDocument(temp_directory);
    await writePravahaConfig(temp_directory, {
      flows: ['docs/flows/runtime/default-fallback.js'],
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback.js',
      createDispatchFlowModuleSource(
        '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([
      expect.objectContaining({
        contract_path: CONTRACT_PATH,
        flow_path: 'docs/flows/runtime/default-fallback.js',
      }),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('logs and skips one owner document when more than one configured flow matches it', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {string[]} */
  const log_lines = [];

  try {
    await writeContractDocument(temp_directory);
    await writePravahaConfig(temp_directory, {
      flows: ['docs/flows/runtime/default-fallback-*.js'],
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback-a.js',
      createDispatchFlowModuleSource(
        '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
      ),
    );
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback-b.js',
      createDispatchFlowModuleSource(
        '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
      ),
    );

    await expect(
      materializeAssignments(temp_directory, { log_lines }),
    ).resolves.toEqual([]);
    expect(log_lines).toEqual([
      expect.stringContaining(
        'Multiple dispatch flows match owner task:implement-runtime-slice',
      ),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('warns when configured flows reference a workspace id that is missing from global config', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {string[]} */
  const log_lines = [];

  try {
    await writePravahaConfig(temp_directory, {
      flows: [
        'docs/flows/runtime/missing-workspace-b.js',
        'docs/flows/runtime/missing-workspace-a.js',
      ],
      workspaces: {},
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/missing-workspace-a.js',
      createDispatchFlowModuleSourceWithWorkspace({
        where_clause:
          '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
        workspace_id: 'missing-app',
      }),
    );
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/missing-workspace-b.js',
      createDispatchFlowModuleSourceWithWorkspace({
        where_clause:
          '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',
        workspace_id: 'missing-app',
      }),
    );

    await expect(
      materializeAssignments(temp_directory, { log_lines }),
    ).resolves.toEqual([]);
    expect(log_lines).toEqual(
      expect.arrayContaining([
        'Workspace "missing-app" is referenced by docs/flows/runtime/missing-workspace-a.js, docs/flows/runtime/missing-workspace-b.js but is not defined in pravaha.config.js workspaces. Startup continues, but execution will be refused.',
      ]),
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('warns and suppresses matching flow instances that already completed', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  /** @type {string[]} */
  const log_lines = [];

  try {
    const initial_assignment =
      await materializeCompletedMatchingAssignment(temp_directory);

    await expect(
      materializeAssignments(temp_directory, { log_lines }),
    ).resolves.toEqual([]);
    expect(log_lines).toEqual([
      expect.stringContaining(
        `pravaha dispatch --flow ${initial_assignment.flow_instance_id}`,
      ),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('allows explicit flow-instance dispatch to override completed-run suppression', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    const initial_assignment =
      await materializeCompletedMatchingAssignment(temp_directory);

    await expect(
      materializeAssignments(temp_directory, {
        explicit_flow_instance_ids: new Set([
          initial_assignment.flow_instance_id,
        ]),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        flow_instance_id: initial_assignment.flow_instance_id,
      }),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('keeps queue-waiting flow instances unresolved without redispatching them', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writeRuntimeRecordFixture(
      temp_directory,
      createRuntimeRecord({
        binding_targets: {
          doc: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        current_handler_name: 'main',
        flow_state: {},
        flow_path: FLOW_PATH,
        format_version: 'javascript-flow-v1',
        outcome: null,
        queue_wait: {
          branch_head: 'branch-head',
          branch_ref: 'refs/heads/review/task-1',
          outcome: null,
          ready_ref: 'refs/queue/ready/0001-review-task-1',
          state: 'waiting',
        },
        run_id: 'run:implement-runtime-slice:2026-03-29T09:00:00.000Z',
        task_id: 'implement-runtime-slice',
        task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
      }),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('blocks conflicting pooled worktrees from unresolved runs while allowing other pooled worktrees', async () => {
  const temp_directory = await createReusableWorktreeFixtureRepo();

  try {
    const approval_assignment = readApprovalAssignment(
      await materializeAssignments(temp_directory),
    );

    await writeRuntimeRecordFixture(
      temp_directory,
      createApprovalRuntimeRecord(approval_assignment),
    );

    const pending_assignments = await materializeAssignments(temp_directory);

    expect(pending_assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contract_path: CONFLICTING_CONTRACT_PATH,
          flow_path: CONFLICTING_FLOW_PATH,
        }),
        expect.objectContaining({
          contract_path: INDEPENDENT_CONTRACT_PATH,
          flow_path: INDEPENDENT_FLOW_PATH,
        }),
      ]),
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('selects a later pooled slot when an earlier declared slot is occupied', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await configurePooledAppWorkspace(temp_directory);
    await writeFlowDocument(
      temp_directory,
      FLOW_PATH,
      createMultiSlotPooledFlowModuleSource(),
    );
    await writeRuntimeRecordFixture(
      temp_directory,
      createOccupiedPooledRuntimeRecord({
        task_id: 'occupied-runtime-slice',
        task_path: 'docs/tasks/runtime/occupied-runtime-slice.md',
        worktree_identity: `${temp_directory}/.pravaha/worktrees/abbott`,
        worktree_path: `${temp_directory}/.pravaha/worktrees/abbott`,
        worktree_slot: `${temp_directory}/.pravaha/worktrees/abbott`,
      }),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([
      expect.objectContaining({
        flow_path: FLOW_PATH,
        workspace: {
          id: 'app',
          location: {
            path: `${temp_directory}/.pravaha/worktrees/castello`,
          },
          mode: 'pooled',
          ref: 'main',
          source: {
            kind: 'repo',
          },
        },
      }),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('leaves multi-slot pooled work unassigned when every declared slot is occupied', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await configurePooledAppWorkspace(temp_directory);
    await writeFlowDocument(
      temp_directory,
      FLOW_PATH,
      createMultiSlotPooledFlowModuleSource(),
    );
    await writeRuntimeRecordFixture(
      temp_directory,
      createOccupiedPooledRuntimeRecord({
        task_id: 'occupied-runtime-slice',
        task_path: 'docs/tasks/runtime/occupied-runtime-slice.md',
        worktree_identity: `${temp_directory}/.pravaha/worktrees/abbott`,
        worktree_path: `${temp_directory}/.pravaha/worktrees/abbott`,
        worktree_slot: `${temp_directory}/.pravaha/worktrees/abbott`,
      }),
    );
    await writeRuntimeRecordFixtureAtPath(
      temp_directory,
      'occupied-second-slot.json',
      createOccupiedPooledRuntimeRecord({
        task_id: 'occupied-runtime-slice-2',
        task_path: 'docs/tasks/runtime/occupied-runtime-slice-2.md',
        worktree_identity: `${temp_directory}/.pravaha/worktrees/castello`,
        worktree_path: `${temp_directory}/.pravaha/worktrees/castello`,
        worktree_slot: `${temp_directory}/.pravaha/worktrees/castello`,
      }),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('treats recorded worktree paths as occupied when legacy runtime identities are missing', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writePravahaConfig(temp_directory, {
      workspaces: {
        app: {
          mode: 'pooled',
          paths: ['.pravaha/worktrees/abbott'],
          ref: 'main',
          source: {
            kind: 'repo',
          },
        },
      },
    });
    const occupied_runtime_record = createOccupiedPooledRuntimeRecord({
      task_id: 'occupied-runtime-slice',
      task_path: 'docs/tasks/runtime/occupied-runtime-slice.md',
      worktree_identity: `${temp_directory}/.pravaha/worktrees/abbott`,
      worktree_path: `${temp_directory}/.pravaha/worktrees/abbott`,
      worktree_slot: `${temp_directory}/.pravaha/worktrees/abbott`,
    });

    occupied_runtime_record.worktree = {
      mode: 'pooled',
      path: `${temp_directory}/.pravaha/worktrees/abbott`,
      slot: `${temp_directory}/.pravaha/worktrees/abbott`,
    };
    await writeRuntimeRecordFixture(temp_directory, occupied_runtime_record);

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects unresolved runtime records whose JSON does not evaluate to an object', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
    await writeFile(
      join(temp_directory, '.pravaha/runtime/implement-runtime-slice.json'),
      '[]\n',
    );

    await expect(materializeAssignments(temp_directory)).rejects.toThrow(
      'Expected runtime record JSON to evaluate to an object.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @returns {Promise<Extract<Awaited<ReturnType<typeof materializePendingAssignments>>[number], { type: 'assignment' }>>}
 */
async function materializeCompletedMatchingAssignment(temp_directory) {
  const [initial_assignment] = await materializeAssignments(temp_directory);

  if (initial_assignment === undefined) {
    throw new Error('Expected a matching flow instance.');
  }

  if (
    typeof initial_assignment.task_id !== 'string' ||
    typeof initial_assignment.task_path !== 'string'
  ) {
    throw new Error(
      'Expected the matching flow instance to include task identity.',
    );
  }

  await writeRuntimeRecordFixture(
    temp_directory,
    createRuntimeRecord({
      binding_targets: initial_assignment.binding_targets,
      contract_path: CONTRACT_PATH,
      current_handler_name: 'main',
      flow_state: {},
      flow_path: FLOW_PATH,
      format_version: 'javascript-flow-v1',
      outcome: 'success',
      run_id: 'run:implement-runtime-slice:2026-03-29T09:00:00.000Z',
      task_id: initial_assignment.task_id,
      task_path: initial_assignment.task_path,
    }),
  );

  return initial_assignment;
}

/**
 * @param {Awaited<ReturnType<typeof materializePendingAssignments>>} assignments
 * @returns {Extract<Awaited<ReturnType<typeof materializePendingAssignments>>[number], { type: 'assignment' }> & { task_id: string, task_path: string }}
 */
function readApprovalAssignment(assignments) {
  const approval_assignment = assignments.find(
    (assignment) => assignment.contract_path === APPROVAL_CONTRACT_PATH,
  );

  if (
    approval_assignment === undefined ||
    typeof approval_assignment.task_id !== 'string' ||
    typeof approval_assignment.task_path !== 'string'
  ) {
    throw new Error('Expected an approval assignment with task identity.');
  }

  return /** @type {typeof approval_assignment & { task_id: string, task_path: string }} */ (
    approval_assignment
  );
}

/**
 * @param {Extract<Awaited<ReturnType<typeof materializePendingAssignments>>[number], { type: 'assignment' }> & { task_id: string, task_path: string }} approval_assignment
 * @returns {Record<string, unknown>}
 */
function createApprovalRuntimeRecord(approval_assignment) {
  return createRuntimeRecord({
    approval: {
      approved_at: null,
      requested_at: '2026-03-29T09:00:00.000Z',
    },
    binding_targets: approval_assignment.binding_targets,
    contract_path: APPROVAL_CONTRACT_PATH,
    current_handler_name: 'onApprove',
    flow_state: {},
    flow_path: APPROVAL_FLOW_PATH,
    format_version: 'javascript-flow-v1',
    wait_state: {
      handler_name: 'onApprove',
      kind: 'approval',
    },
    outcome: null,
    run_id: 'run:approval:2026-03-29T09:00:00.000Z',
    task_id: approval_assignment.task_id,
    task_path: approval_assignment.task_path,
  });
}

/**
 * @param {string} temp_directory
 * @param {{
 *   explicit_flow_instance_ids?: Set<string>,
 *   log_lines?: string[],
 * }} [options]
 * @returns {Promise<Awaited<ReturnType<typeof materializePendingAssignments>>>}
 */
async function materializeAssignments(temp_directory, options = {}) {
  return materializePendingAssignments(
    {
      emit_event() {
        return Promise.resolve();
      },
      endpoint: '/tmp/dispatch.sock',
      graph_api: resolveGraphApi(undefined),
      log_to_operator(line) {
        options.log_lines?.push(line);
      },
      now() {
        return new Date();
      },
      repo_directory: temp_directory,
      worker_id: 'worker-dispatcher',
    },
    {
      explicit_flow_instance_ids: options.explicit_flow_instance_ids,
    },
  );
}

/**
 * @param {string} temp_directory
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecordFixture(temp_directory, runtime_record) {
  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeFile(
    join(temp_directory, '.pravaha/runtime/implement-runtime-slice.json'),
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}

/**
 * @param {string} temp_directory
 * @param {string} filename
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecordFixtureAtPath(
  temp_directory,
  filename,
  runtime_record,
) {
  await mkdir(join(temp_directory, '.pravaha/runtime'), { recursive: true });
  await writeFile(
    join(temp_directory, '.pravaha/runtime', filename),
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function writeContractDocument(temp_directory) {
  /** @type {Array<[string, string]>} */
  const metadata = [
    ['Kind', 'contract'],
    ['Id', 'single-task-flow-reconciler'],
    ['Status', 'proposed'],
    ['Decided by', 'docs/decisions/runtime/trigger-driven-codex-runtime.md'],
  ];

  await writeFile(
    join(temp_directory, CONTRACT_PATH),
    createFixtureDocument({
      body: '# Single-Task Flow Reconciler\n',
      metadata,
    }),
  );
}

/**
 * @param {string} temp_directory
 * @param {Record<string, unknown>} override
 * @returns {Promise<void>}
 */
async function writePravahaConfig(temp_directory, override) {
  await writeFile(
    join(temp_directory, 'pravaha.config.js'),
    createPravahaConfigSource({
      ...pravaha_config,
      ...override,
    }),
  );
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function configurePooledAppWorkspace(temp_directory) {
  await writePravahaConfig(temp_directory, {
    flows: [FLOW_PATH],
    workspaces: {
      app: {
        mode: 'pooled',
        paths: ['.pravaha/worktrees/abbott', '.pravaha/worktrees/castello'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
  });
}

/**
 * @param {string} temp_directory
 * @param {string} flow_path
 * @param {string} flow_document_text
 * @returns {Promise<void>}
 */
async function writeFlowDocument(
  temp_directory,
  flow_path,
  flow_document_text,
) {
  await writeFile(join(temp_directory, flow_path), flow_document_text);
}

/**
 * @param {string} where_clause
 * @returns {string}
 */
function createDispatchFlowModuleSource(where_clause) {
  return createDispatchFlowModuleSourceWithWorkspace({
    where_clause,
  });
}

/**
 * @param {{
 *   where_clause: string,
 *   workspace_id?: string,
 * }} options
 * @returns {string}
 */
function createDispatchFlowModuleSourceWithWorkspace(options) {
  return [
    "import { defineFlow, run } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    `    patram: '${options.where_clause}',`,
    '  },',
    `  workspace: '${options.workspace_id ?? 'app'}',`,
    '  async main(ctx) {',
    "    await run(ctx, { command: 'true' });",
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createMultiSlotPooledFlowModuleSource() {
  return [
    "import { defineFlow, run } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    '  on: {',
    "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
    '  },',
    "  workspace: 'app',",
    '  async main(ctx) {',
    "    await run(ctx, { command: 'true' });",
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * @param {{
 *   task_id: string,
 *   task_path: string,
 *   worktree_identity: string,
 *   worktree_path: string,
 *   worktree_slot: string,
 * }} options
 * @returns {Record<string, unknown>}
 */
function createOccupiedPooledRuntimeRecord(options) {
  return createRuntimeRecord({
    approval: {
      approved_at: null,
      requested_at: '2026-03-29T09:00:00.000Z',
    },
    binding_targets: {
      doc: {
        id: `task:${options.task_id}`,
        path: options.task_path,
        status: 'ready',
      },
    },
    contract_path: CONTRACT_PATH,
    current_handler_name: 'main',
    flow_state: {},
    flow_path: FLOW_PATH,
    format_version: 'javascript-flow-v1',
    outcome: null,
    run_id: `run:${options.task_id}:2026-03-29T09:00:00.000Z`,
    task_id: options.task_id,
    task_path: options.task_path,
    worktree_identity: options.worktree_identity,
    worktree_mode: 'pooled',
    worktree_path: options.worktree_path,
    worktree_slot: options.worktree_slot,
  });
}
