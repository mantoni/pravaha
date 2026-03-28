export { pluralize, renderRuntimeFailure, renderValidationFailure };

/**
 * @param {{ checked_flow_count: number, diagnostics: Array<{ file_path: string, message: string }> }} validation_result
 * @returns {string}
 */
function renderValidationFailure(validation_result) {
  const diagnostic_lines = validation_result.diagnostics
    .map(
      /**
       * @param {{ file_path: string, message: string }} diagnostic
       * @returns {string}
       */
      (diagnostic) => `${diagnostic.file_path}: ${diagnostic.message}`,
    )
    .join('\n');

  return [
    'Validation failed.',
    diagnostic_lines,
    `Checked ${validation_result.checked_flow_count} flow document${pluralize(validation_result.checked_flow_count)}.`,
    '',
  ].join('\n');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function renderRuntimeFailure(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {number} count
 * @returns {string}
 */
function pluralize(count) {
  if (count === 1) {
    return '';
  }

  return 's';
}
