export type RepoConfig = import('patram').PatramRepoConfig;

export interface DiagnosticLike {
  file_path?: string;
  message: string;
  path?: string;
}

export interface GraphNode {
  $class?: string;
  $id?: string;
  $path?: string;
  id: string;
  status?: string;
  [field: string]: unknown;
}

export interface GraphEdge {
  from: string;
  id?: string;
  origin?: {
    column: number;
    line: number;
    path: string;
  };
  relation: string;
  to: string;
}

export interface BuildGraphResult {
  document_node_ids?: Record<string, string>;
  edges: GraphEdge[];
  nodes: Record<string, GraphNode>;
}

export type RepoConfigLike =
  | RepoConfig
  | { relations?: Record<string, unknown> };

export interface QueryResult {
  diagnostics: DiagnosticLike[];
  nodes: GraphNode[];
  total_count?: number;
}

export interface ProjectGraphResult {
  config: RepoConfigLike;
  diagnostics: DiagnosticLike[];
  graph: BuildGraphResult;
}

export interface GraphApi {
  load_project_graph: (repo_directory: string) => Promise<ProjectGraphResult>;
  query_graph: (
    graph: BuildGraphResult,
    where_clause: string,
    repo_config?: RepoConfigLike,
  ) => QueryResult;
}

export interface QueryGraphApi {
  query_graph: GraphApi['query_graph'];
}

export interface OptionalGraphApi {
  load_project_graph?: GraphApi['load_project_graph'];
  query_graph?: GraphApi['query_graph'];
}
