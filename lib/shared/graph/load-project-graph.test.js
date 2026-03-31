/** @import * as $k$$k$$l$types$l$patram$j$types$k$ts from '../types/patram-types.ts'; */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

const { loadPatramProjectGraphMock, loadPravahaConfigMock } = vi.hoisted(
  () => ({
    loadPatramProjectGraphMock: vi.fn(),
    loadPravahaConfigMock: vi.fn(),
  }),
);

vi.mock(import('patram'), () => ({
  loadProjectGraph: loadPatramProjectGraphMock,
}));

vi.mock(import('../../config/load-pravaha-config.js'), () => ({
  loadPravahaConfig: loadPravahaConfigMock,
}));

afterEach(() => {
  vi.resetModules();
  loadPatramProjectGraphMock.mockReset();
  loadPravahaConfigMock.mockReset();
});

it('returns the Patram graph unchanged when pravaha config is valid', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-graph-'));
  const base_project_graph_result = createBaseProjectGraphResult();

  try {
    await writeConfiguredContractFixtures(temp_directory);
    mockGraphLoad({
      base_project_graph_result,
      diagnostics: [],
    });

    const { loadProjectGraph } = await import('./load-project-graph.js');
    const project_graph_result = await loadProjectGraph(temp_directory);

    expect(project_graph_result).toBe(base_project_graph_result);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns the Patram graph unchanged for the default flow config', async () => {
  const base_project_graph_result = createBaseProjectGraphResult();

  mockGraphLoad({
    base_project_graph_result,
    diagnostics: [],
  });

  const { loadProjectGraph } = await import('./load-project-graph.js');

  await expect(loadProjectGraph('/repo')).resolves.toBe(
    base_project_graph_result,
  );
});

it('returns pravaha config diagnostics with an empty graph', async () => {
  mockGraphLoad({
    diagnostics: [
      {
        file_path: 'pravaha.json',
        message: 'bad config',
      },
    ],
  });

  const { loadProjectGraph } = await import('./load-project-graph.js');

  await expect(loadProjectGraph('/repo')).resolves.toMatchObject({
    diagnostics: [
      {
        code: 'pravaha_config',
        message: 'bad config',
        path: 'pravaha.json',
      },
    ],
    graph: {
      edges: [],
      nodes: {},
    },
  });
});

/**
 * @returns {$k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult}
 */
function createBaseProjectGraphResult() {
  return {
    claims: [],
    config: {
      include: [],
      queries: {},
      relations: {
        root_flow: {
          from: ['contract'],
          to: ['flow'],
        },
      },
    },
    diagnostics: [],
    graph: {
      edges: createBaseGraphEdges(),
      nodes: createBaseGraphNodes(),
    },
    source_file_paths: [],
  };
}

/**
 * @param {{
 *   base_project_graph_result?: $k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult,
 *   diagnostics: Array<{ file_path: string, message: string }>,
 * }} options
 * @returns {void}
 */
function mockGraphLoad(options) {
  loadPatramProjectGraphMock.mockResolvedValue(
    options.base_project_graph_result ?? createBaseProjectGraphResult(),
  );
  loadPravahaConfigMock.mockResolvedValue({
    config: {
      flow_config: {
        matches: [],
      },
    },
    diagnostics: options.diagnostics,
  });
}

/**
 * @param {string} temp_directory
 * @returns {Promise<void>}
 */
async function writeConfiguredContractFixtures(temp_directory) {
  await mkdir(join(temp_directory, 'docs/contracts'), { recursive: true });
  await writeFile(
    join(temp_directory, 'docs/contracts/custom.md'),
    '# Contract\n',
  );
  await writeFile(
    join(temp_directory, 'docs/contracts/plain.md'),
    '# Not front matter\n',
  );
  await writeFile(
    join(temp_directory, 'docs/contracts/existing.md'),
    '# Contract\n',
  );
}

/**
 * @returns {$k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult['graph']['edges']}
 */
function createBaseGraphEdges() {
  return [
    {
      from: 'contract:existing',
      id: 'edge:1',
      origin: {
        column: 1,
        line: 2,
        path: 'docs/contracts/existing.md',
      },
      relation: 'root_flow',
      to: 'flow:docs/flows/runtime/existing.js',
    },
  ];
}

/**
 * @returns {$k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult['graph']['nodes']}
 */
function createBaseGraphNodes() {
  return {
    'contract:custom': {
      $class: 'contract',
      $id: 'contract:custom',
      $path: 'docs/contracts/custom.md',
      id: 'contract:custom',
    },
    'contract:existing': {
      $class: 'contract',
      $id: 'contract:existing',
      $path: 'docs/contracts/existing.md',
      id: 'contract:existing',
    },
    'contract:plain': {
      $class: 'contract',
      $id: 'contract:plain',
      $path: 'docs/contracts/plain.md',
      id: 'contract:plain',
    },
    'flow:docs/flows/runtime/existing.js': {
      $class: 'flow',
      $id: 'flow:docs/flows/runtime/existing.js',
      $path: 'docs/flows/runtime/existing.js',
      id: 'flow:docs/flows/runtime/existing.js',
    },
  };
}
