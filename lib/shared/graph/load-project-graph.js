/** @import { BuildGraphResult, GraphNode, ProjectGraphResult } from '../types/patram-types.ts' */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadProjectGraph as loadPatramProjectGraph } from 'patram';

import { loadPravahaConfig } from '../../config/load-pravaha-config.js';

export { loadProjectGraph };

/**
 * @param {string} project_directory
 * @returns {Promise<ProjectGraphResult>}
 */
async function loadProjectGraph(project_directory) {
  const project_graph_result = await loadPatramProjectGraph(project_directory);
  const pravaha_config_result = await loadPravahaConfig(project_directory);

  if (pravaha_config_result.diagnostics.length > 0) {
    return {
      ...project_graph_result,
      diagnostics: pravaha_config_result.diagnostics.map((diagnostic) => ({
        file_path: diagnostic.file_path,
        message: diagnostic.message,
      })),
      graph: {
        edges: [],
        nodes: {},
      },
    };
  }

  if (
    project_graph_result.diagnostics.length > 0 ||
    pravaha_config_result.config.flow_config.root_flow_label === 'Root flow'
  ) {
    return project_graph_result;
  }

  return {
    ...project_graph_result,
    graph: await augmentGraphWithConfiguredRootFlowLabel(
      project_directory,
      project_graph_result.graph,
      pravaha_config_result.config.flow_config.root_flow_label,
    ),
  };
}

/**
 * @param {string} project_directory
 * @param {BuildGraphResult} graph
 * @param {string} root_flow_label
 * @returns {Promise<BuildGraphResult>}
 */
async function augmentGraphWithConfiguredRootFlowLabel(
  project_directory,
  graph,
  root_flow_label,
) {
  const normalized_root_flow_label = normalizeDirectiveName(root_flow_label);
  /** @type {BuildGraphResult} */
  const augmented_graph = {
    edges: [...graph.edges],
    nodes: { ...graph.nodes },
  };

  for (const contract_node of Object.values(graph.nodes)) {
    if (
      contract_node.$class !== 'contract' ||
      typeof contract_node.$path !== 'string' ||
      hasRootFlowEdge(contract_node, graph)
    ) {
      continue;
    }

    const contract_source = await readFile(
      resolve(project_directory, contract_node.$path),
      'utf8',
    );
    const root_flow_reference = readConfiguredRootFlowReference(
      contract_source,
      normalized_root_flow_label,
    );

    if (root_flow_reference === null) {
      continue;
    }

    const flow_node_id = ensureFlowNode(
      augmented_graph.nodes,
      root_flow_reference.flow_path,
    );

    augmented_graph.edges.push({
      from: contract_node.id,
      id: `edge:${augmented_graph.edges.length + 1}`,
      origin: {
        column: 1,
        line: root_flow_reference.line,
        path: contract_node.$path,
      },
      relation: 'root_flow',
      to: flow_node_id,
    });
  }

  return augmented_graph;
}

/**
 * @param {GraphNode} contract_node
 * @param {BuildGraphResult} graph
 * @returns {boolean}
 */
function hasRootFlowEdge(contract_node, graph) {
  return graph.edges.some(
    (graph_edge) =>
      graph_edge.from === contract_node.id &&
      graph_edge.relation === 'root_flow',
  );
}

/**
 * @param {Record<string, GraphNode>} graph_nodes
 * @param {string} flow_path
 * @returns {string}
 */
function ensureFlowNode(graph_nodes, flow_path) {
  for (const graph_node of Object.values(graph_nodes)) {
    if (graph_node.$class === 'flow' && graph_node.$path === flow_path) {
      return graph_node.id;
    }
  }

  const flow_node_id = `flow:${flow_path}`;

  graph_nodes[flow_node_id] = {
    $class: 'flow',
    $id: flow_node_id,
    $path: flow_path,
    id: flow_node_id,
  };

  return flow_node_id;
}

/**
 * @param {string} contract_source
 * @param {string} normalized_root_flow_label
 * @returns {{ flow_path: string, line: number } | null}
 */
function readConfiguredRootFlowReference(
  contract_source,
  normalized_root_flow_label,
) {
  const front_matter = readFrontMatter(contract_source);

  if (front_matter === null) {
    return null;
  }

  for (const [line_index, line_text] of front_matter.lines.entries()) {
    const directive_match = /^(?<label>[^:]+):\s*(?<value>.+)\s*$/du.exec(
      line_text,
    );

    if (!directive_match?.groups) {
      continue;
    }

    if (
      normalizeDirectiveName(directive_match.groups.label) !==
      normalized_root_flow_label
    ) {
      continue;
    }

    return {
      flow_path: directive_match.groups.value.trim(),
      line: front_matter.start_line + line_index,
    };
  }

  return null;
}

/**
 * @param {string} contract_source
 * @returns {{ lines: string[], start_line: number } | null}
 */
function readFrontMatter(contract_source) {
  const source_lines = contract_source.split('\n');

  if (source_lines[0] !== '---') {
    return null;
  }

  const closing_line_index = source_lines.indexOf('---', 1);

  if (closing_line_index < 0) {
    return null;
  }

  return {
    lines: source_lines.slice(1, closing_line_index),
    start_line: 2,
  };
}

/**
 * @param {string} directive_label
 * @returns {string}
 */
function normalizeDirectiveName(directive_label) {
  return directive_label
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/dgu, '_');
}
