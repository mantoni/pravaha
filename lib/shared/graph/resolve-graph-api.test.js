import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import pravaha_config from '../../../pravaha.json' with { type: 'json' };
import {
  CONTRACT_PATH,
  FLOW_PATH,
  createReconcilerFixtureRepo,
} from '../../../test/fixtures/reconcile-fixture.js';
import { createFixtureDocument } from '../../../test/fixtures/runtime-fixture.js';
import { resolveGraphApi } from './resolve-graph-api.js';

it('resolves default Patram graph APIs', () => {
  expect(resolveGraphApi(undefined)).toMatchObject({
    load_project_graph: asMatcher(expect.any(Function)),
    query_graph: asMatcher(expect.any(Function)),
  });
});

it('accepts the configured root flow label while preserving the root_flow relation', async () => {
  const temp_directory = await createReconcilerFixtureRepo();
  const graph_api = resolveGraphApi(undefined);

  try {
    await writeConfiguredRootFlowFixture(temp_directory);

    const project_graph_result =
      await graph_api.load_project_graph(temp_directory);

    expect(project_graph_result.diagnostics).toEqual([]);
    expect(project_graph_result.graph.edges).toContainEqual({
      from: 'contract:single-task-flow-reconciler',
      id: asMatcher(expect.any(String)),
      origin: asMatcher(expect.any(Object)),
      relation: 'root_flow',
      to: `flow:${FLOW_PATH}`,
    });
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
    join(temp_directory, 'pravaha.json'),
    `${JSON.stringify(
      {
        ...pravaha_config,
        flows: {
          root_flow_label: 'Implementation flow',
        },
      },
      null,
      2,
    )}\n`,
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

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
