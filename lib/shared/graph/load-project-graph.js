/** @import { ProjectGraphResult } from '../types/patram-types.ts' */

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

  return project_graph_result;
}
