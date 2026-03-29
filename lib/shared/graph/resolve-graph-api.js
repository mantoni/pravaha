/** @import { GraphApi, OptionalGraphApi } from '../types/patram-types.ts' */

import { loadProjectGraph, queryGraph } from 'patram';

export { resolveGraphApi };

/**
 * @param {OptionalGraphApi | undefined} graph_api
 * @returns {GraphApi}
 */
function resolveGraphApi(graph_api) {
  return {
    load_project_graph:
      graph_api?.load_project_graph ??
      /** @type {GraphApi['load_project_graph']} */ (loadProjectGraph),
    query_graph:
      graph_api?.query_graph ??
      /** @type {GraphApi['query_graph']} */ (queryGraph),
  };
}
