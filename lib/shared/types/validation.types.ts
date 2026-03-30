export interface ValidationDiagnostic {
  file_path: string;
  message: string;
}

export interface ValidationResult {
  checked_flow_count: number;
  diagnostics: ValidationDiagnostic[];
}

export interface JsonReadResult {
  value: unknown;
  diagnostics: ValidationDiagnostic[];
}

export interface SemanticModel {
  semantic_role_names: Set<string>;
  semantic_state_names: Set<string>;
}

export interface PatramModel {
  class_names: Set<string>;
  status_names: Set<string>;
}
