import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.json' with { type: 'json' };
import {
  APPROVAL_CONTRACT_PATH,
  APPROVAL_FLOW_PATH,
  createReusableWorktreeFixtureRepo,
  INDEPENDENT_CONTRACT_PATH,
  INDEPENDENT_FLOW_PATH,
} from '../../../test/fixtures/dispatch-fixture.js';
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createFixtureDocument } from '../../../test/fixtures/runtime-fixture.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { materializePendingAssignments } from './assignments.js';

it('keeps explicit contract flow bindings authoritative over fallback matches', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: ['docs/flows/runtime/default-fallback.yaml'],
      },
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback.yaml',
      createDispatchFlowDocumentText(
        'default-fallback',
        '$class == task and tracked_in == @document and status == ready',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contract_path: CONTRACT_PATH,
          flow_path: 'docs/flows/runtime/single-task-flow-reconciler.yaml',
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
    await writeContractDocument(temp_directory, null);
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: ['docs/flows/runtime/no-match.yaml'],
      },
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/no-match.yaml',
      createDispatchFlowDocumentText(
        'no-match',
        '$class == task and tracked_in == @document and status == review',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('schedules a fallback flow when exactly one default candidate matches', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writeContractDocument(temp_directory, null);
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: ['docs/flows/runtime/default-fallback.yaml'],
      },
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback.yaml',
      createDispatchFlowDocumentText(
        'default-fallback',
        '$class == task and tracked_in == @document and status == ready',
      ),
    );

    await expect(materializeAssignments(temp_directory)).resolves.toEqual([
      expect.objectContaining({
        contract_path: CONTRACT_PATH,
        flow_path: 'docs/flows/runtime/default-fallback.yaml',
      }),
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('fails clearly when more than one fallback flow matches the same task', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await writeContractDocument(temp_directory, null);
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: ['docs/flows/runtime/default-fallback-*.yaml'],
      },
    });
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback-a.yaml',
      createDispatchFlowDocumentText(
        'default-fallback-a',
        '$class == task and tracked_in == @document and status == ready',
      ),
    );
    await writeFlowDocument(
      temp_directory,
      'docs/flows/runtime/default-fallback-b.yaml',
      createDispatchFlowDocumentText(
        'default-fallback-b',
        '$class == task and tracked_in == @document and status == ready',
      ),
    );

    await expect(materializeAssignments(temp_directory)).rejects.toThrow(
      /Ambiguous fallback flow match for task task:implement-runtime-slice[\s\S]*default-fallback-a\.yaml[\s\S]*default-fallback-b\.yaml/u,
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
          task: {
            id: 'task:implement-runtime-slice',
            path: 'docs/tasks/runtime/implement-runtime-slice.md',
            status: 'ready',
          },
        },
        contract_path: CONTRACT_PATH,
        current_job_name: 'queue_review',
        flow_path: FLOW_PATH,
        format_version: 'state-machine-v2',
        job_outputs: {},
        job_visit_counts: {
          queue_review: 1,
        },
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

    expect(pending_assignments).toEqual([
      expect.objectContaining({
        contract_path: INDEPENDENT_CONTRACT_PATH,
        flow_path: INDEPENDENT_FLOW_PATH,
      }),
    ]);
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
      current_job_name: 'done',
      flow_path: FLOW_PATH,
      format_version: 'state-machine-v2',
      job_outputs: {},
      job_visit_counts: {
        implement: 1,
      },
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
    current_job_name: 'review',
    flow_path: APPROVAL_FLOW_PATH,
    format_version: 'state-machine-v2',
    job_outputs: {},
    job_visit_counts: {
      review: 1,
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
 * @param {string | null} flow_path
 * @returns {Promise<void>}
 */
async function writeContractDocument(temp_directory, flow_path) {
  /** @type {Array<[string, string]>} */
  const metadata = [
    ['Kind', 'contract'],
    ['Id', 'single-task-flow-reconciler'],
    ['Status', 'proposed'],
    ['Decided by', 'docs/decisions/runtime/trigger-driven-codex-runtime.md'],
  ];

  if (typeof flow_path === 'string') {
    metadata.push(['Root flow', flow_path]);
  }

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
    join(temp_directory, 'pravaha.json'),
    `${JSON.stringify(
      {
        ...pravaha_config,
        ...override,
      },
      null,
      2,
    )}\n`,
  );
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
 * @param {string} flow_id
 * @param {string} where_clause
 * @returns {string}
 */
function createDispatchFlowDocumentText(flow_id, where_clause) {
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
    '    mode: ephemeral',
    '    ref: main',
    '',
    'on:',
    '  task:',
    `    where: ${where_clause}`,
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
