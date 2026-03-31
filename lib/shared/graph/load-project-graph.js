/** @import * as patram from 'patram'; */
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
      diagnostics: pravaha_config_result.diagnostics.map(
        createPatramDiagnostic,
      ),
      graph: {
        edges: [],
        nodes: {},
      },
    };
  }

  return project_graph_result;
}

/**
 * @param {{ file_path: string, message: string }} diagnostic
 * @returns {patram.PatramDiagnostic}
 */
function createPatramDiagnostic(diagnostic) {
  return {
    code: 'pravaha_config',
    column: 1,
    level: 'error',
    line: 1,
    message: diagnostic.message,
    path: diagnostic.file_path,
  };
}
