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

it('adds a configured root_flow edge only for contracts that need one', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-graph-'));

  try {
    await writeConfiguredContractFixtures(temp_directory);
    mockGraphLoad({
      diagnostics: [],
      root_flow_label: 'Implementation flow',
    });

    const { loadProjectGraph } = await import('./load-project-graph.js');
    const project_graph_result = await loadProjectGraph(temp_directory);

    expect(project_graph_result.graph.edges).toContainEqual({
      from: 'contract:custom',
      id: 'edge:2',
      origin: {
        column: 1,
        line: 2,
        path: 'docs/contracts/custom.md',
      },
      relation: 'root_flow',
      to: 'flow:docs/flows/runtime/custom.yaml',
    });
    expect(project_graph_result.graph.edges).not.toContainEqual(
      expect.objectContaining({
        from: 'contract:plain',
        relation: 'root_flow',
      }),
    );
    expect(
      project_graph_result.graph.edges.filter(
        (graph_edge) =>
          graph_edge.from === 'contract:existing' &&
          graph_edge.relation === 'root_flow',
      ),
    ).toHaveLength(1);
    expect(project_graph_result.graph.nodes).toMatchObject({
      'flow:docs/flows/runtime/custom.yaml': {
        $class: 'flow',
        $id: 'flow:docs/flows/runtime/custom.yaml',
        $path: 'docs/flows/runtime/custom.yaml',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns the Patram graph unchanged for the default root flow label', async () => {
  const base_project_graph_result = createBaseProjectGraphResult();

  mockGraphLoad({
    base_project_graph_result,
    diagnostics: [],
    root_flow_label: 'Root flow',
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
    root_flow_label: 'Implementation flow',
  });

  const { loadProjectGraph } = await import('./load-project-graph.js');

  await expect(loadProjectGraph('/repo')).resolves.toMatchObject({
    diagnostics: [
      {
        file_path: 'pravaha.json',
        message: 'bad config',
      },
    ],
    graph: {
      edges: [],
      nodes: {},
    },
  });
});

/**
 * @param {string} front_matter_line
 * @returns {string}
 */
function createContractSource(front_matter_line) {
  return `---\n${front_matter_line}\n---\n# Contract\n`;
}

/**
 * @returns {$k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult}
 */
function createBaseProjectGraphResult() {
  return {
    config: {
      relations: {
        root_flow: {},
      },
    },
    diagnostics: [],
    graph: {
      edges: createBaseGraphEdges(),
      nodes: createBaseGraphNodes(),
    },
  };
}

/**
 * @param {{
 *   base_project_graph_result?: $k$$k$$l$types$l$patram$j$types$k$ts.ProjectGraphResult,
 *   diagnostics: Array<{ file_path: string, message: string }>,
 *   root_flow_label: string,
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
        default_matches: [],
        root_flow_label: options.root_flow_label,
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
    createContractSource('Implementation flow: docs/flows/runtime/custom.yaml'),
  );
  await writeFile(
    join(temp_directory, 'docs/contracts/plain.md'),
    '# Not front matter\n',
  );
  await writeFile(
    join(temp_directory, 'docs/contracts/existing.md'),
    createContractSource(
      'Implementation flow: docs/flows/runtime/existing.yaml',
    ),
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
      to: 'flow:docs/flows/runtime/existing.yaml',
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
    'flow:docs/flows/runtime/existing.yaml': {
      $class: 'flow',
      $id: 'flow:docs/flows/runtime/existing.yaml',
      $path: 'docs/flows/runtime/existing.yaml',
      id: 'flow:docs/flows/runtime/existing.yaml',
    },
  };
}
