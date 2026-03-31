import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.json' with { type: 'json' };
import {
  CONTRACT_PATH,
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { cleanupExpiredTerminalRuntimeRecords } from './runtime-retention.js';

it('deletes expired terminal runtime records when the exact match no longer exists', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: [],
      },
    });
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(access(runtime_record_path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('uses the default clock when cleanup runs without an injected time source', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writePravahaConfig(temp_directory, {
      flows: {
        default_matches: [],
      },
    });
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc', {
        completed_at: '2000-01-01T00:00:00.000Z',
      }),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
    });

    await expect(access(runtime_record_path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('retains expired terminal runtime records while the exact match still exists', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('leaves terminal runtime records in place before the grace period expires', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc', {
        completed_at: '2026-03-31T09:00:00.000Z',
      }),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T08:59:59.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('leaves terminal runtime records in place when completed_at is malformed', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc', {
        completed_at: 'not-a-date',
      }),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('skips cleanup when project-graph loading is unavailable', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: {
        load_project_graph() {
          return Promise.reject(new Error('boom'));
        },
        query_graph: /** @type {any} */ (
          () => {
            throw new Error('should not run');
          }
        ),
      },
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('skips cleanup when pravaha config is invalid', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeFile(join(temp_directory, 'pravaha.json'), '{\n');
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('matches owner documents that expose id without $id during retention checks', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: {
        load_project_graph() {
          return Promise.resolve({
            config: {
              relations: {},
            },
            diagnostics: [],
            graph: {
              edges: [],
              nodes: {},
            },
          });
        },
        query_graph: /** @type {any} */ (
          () => ({
            diagnostics: [],
            nodes: [
              {
                id: 'task:implement-runtime-slice',
              },
            ],
          })
        ),
      },
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('skips cleanup when the project graph reports diagnostics', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: {
        load_project_graph() {
          return Promise.resolve({
            config: {
              relations: {},
            },
            diagnostics: [
              {
                message: 'bad graph',
                path: 'docs/contracts/runtime/reconciler.md',
                severity: 'error',
              },
            ],
            graph: {
              edges: [],
              nodes: {},
            },
          });
        },
        query_graph: /** @type {any} */ (
          () => {
            throw new Error('should not run');
          }
        ),
      },
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('retains expired terminal runtime records when the match identity cannot be derived', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(runtime_record_path, {
      ...createTerminalRuntimeRecord('abc'),
      binding_targets: {},
    });

    await cleanupExpiredTerminalRuntimeRecords(temp_directory, {
      graph_api: resolveGraphApi(undefined),
      now() {
        return new Date('2026-04-02T10:00:00.000Z');
      },
    });

    await expect(readFile(runtime_record_path, 'utf8')).resolves.toContain(
      '"flow_instance_id": "abc"',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('throws when a retained owner match exposes no usable id', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const runtime_record_path = join(temp_directory, '.pravaha/runtime/abc.json');

  try {
    await writeRuntimeRecordFixture(
      runtime_record_path,
      createTerminalRuntimeRecord('abc'),
    );

    await expect(
      cleanupExpiredTerminalRuntimeRecords(temp_directory, {
        graph_api: {
          load_project_graph() {
            return Promise.resolve({
              config: {
                relations: {},
              },
              diagnostics: [],
              graph: {
                edges: [],
                nodes: {},
              },
            });
          },
          query_graph: /** @type {any} */ (
            () => ({
              diagnostics: [],
              nodes: [{}],
            })
          ),
        },
        now() {
          return new Date('2026-04-02T10:00:00.000Z');
        },
      }),
    ).rejects.toThrow('Expected a matched owner document to expose an id.');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} flow_instance_id
 * @param {{ completed_at?: string }} [options]
 * @returns {Record<string, unknown>}
 */
function createTerminalRuntimeRecord(flow_instance_id, options = {}) {
  return createRuntimeRecord({
    binding_targets: {
      doc: {
        id: 'task:implement-runtime-slice',
        path: 'docs/tasks/runtime/implement-runtime-slice.md',
        status: 'ready',
      },
    },
    completed_at: options.completed_at ?? '2026-03-29T09:00:00.000Z',
    contract_path: CONTRACT_PATH,
    current_handler_name: 'main',
    flow_instance_id,
    flow_state: {},
    flow_path: FLOW_PATH,
    format_version: 'javascript-flow-v1',
    outcome: 'success',
    run_id: 'run:abc:2026-03-29T09:00:00.000Z',
    task_id: flow_instance_id,
    task_path: 'docs/tasks/runtime/implement-runtime-slice.md',
  });
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
 * @param {string} runtime_record_path
 * @param {Record<string, unknown>} runtime_record
 * @returns {Promise<void>}
 */
async function writeRuntimeRecordFixture(runtime_record_path, runtime_record) {
  await mkdir(dirname(runtime_record_path), { recursive: true });
  await writeFile(
    runtime_record_path,
    `${JSON.stringify(runtime_record, null, 2)}\n`,
  );
}
