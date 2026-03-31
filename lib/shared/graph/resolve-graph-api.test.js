import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.config.js';
import {
  CONTRACT_PATH,
  FLOW_PATH,
  createReconcilerFixtureRepo,
} from '../../../test/fixtures/reconcile-fixture.js';
import {
  createFixtureDocument,
  createPravahaConfigSource,
} from '../../../test/fixtures/runtime-fixture.js';
import { resolveGraphApi } from './resolve-graph-api.js';

it('resolves default Patram graph APIs', () => {
  const graph_api = resolveGraphApi(undefined);

  expect(typeof graph_api.load_project_graph).toBe('function');
  expect(typeof graph_api.query_graph).toBe('function');
});

it('does not synthesize root_flow relations from stale contract metadata', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const graph_api = resolveGraphApi(undefined);

  try {
    await writeConfiguredRootFlowFixture(temp_directory);

    const project_graph_result =
      await graph_api.load_project_graph(temp_directory);

    expect(project_graph_result.diagnostics).toEqual([]);
    expect(
      project_graph_result.graph.edges.some(
        (graph_edge) => graph_edge.relation === 'root_flow',
      ),
    ).toBe(false);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function writeConfiguredRootFlowFixture(temp_directory) {
  await writeFile(
    join(temp_directory, 'pravaha.config.js'),
    createPravahaConfigSource({
      ...pravaha_config,
    }),
  );
  await writeFile(
    join(temp_directory, CONTRACT_PATH),
    createFixtureDocument({
      body: '# Single-Task Flow Reconciler\n',
      metadata: [
        ['Kind', 'contract'],
        ['Id', 'single-task-flow-reconciler'],
        ['Status', 'proposed'],
        [
          'Decided by',
          'docs/decisions/runtime/trigger-driven-codex-runtime.md',
        ],
        ['Implementation flow', FLOW_PATH],
      ],
    }),
  );
}
