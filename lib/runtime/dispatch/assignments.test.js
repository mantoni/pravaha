import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.json' with { type: 'json' };
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createFixtureDocument } from '../../../test/fixtures/runtime-fixture.js';
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

/**
 * @param {string} temp_directory
 * @returns {Promise<Awaited<ReturnType<typeof materializePendingAssignments>>>}
 */
async function materializeAssignments(temp_directory) {
  return materializePendingAssignments({
    emit_event() {
      return Promise.resolve();
    },
    endpoint: '/tmp/dispatch.sock',
    graph_api: resolveGraphApi(undefined),
    log_to_operator() {},
    now() {
      return new Date();
    },
    repo_directory: temp_directory,
    worker_id: 'worker-dispatcher',
  });
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
