export type DiagnosticLike = import('patram').PatramDiagnostic;
export type GraphNode = import('patram').PatramGraphNode;
export type GraphEdge = import('patram').PatramGraphEdge;
export type BuildGraphResult = import('patram').PatramBuildGraphResult;
export type QueryGraphOptions = import('patram').PatramQueryGraphOptions;
export type QueryResult = import('patram').PatramQueryResult;
export type ProjectGraphResult = import('patram').PatramProjectGraphResult;
export type RepoConfig = import('patram').PatramRepoConfig;

export type RepoConfigLike =
  | RepoConfig
  | { relations?: Record<string, unknown> };

export interface GraphApi {
  load_project_graph: (repo_directory: string) => Promise<ProjectGraphResult>;
  query_graph: (
    graph: BuildGraphResult,
    where_clause: string,
    repo_config_or_query_options?: RepoConfigLike | QueryGraphOptions,
    query_options?: QueryGraphOptions,
  ) => QueryResult;
}

export interface QueryGraphApi {
  query_graph: GraphApi['query_graph'];
}

export interface OptionalGraphApi {
  load_project_graph?: GraphApi['load_project_graph'];
  query_graph?: GraphApi['query_graph'];
}
