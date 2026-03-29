import vm from 'node:vm';

export { renderStateMachineValue, selectStateMachineNextTarget };

/**
 * @param {unknown} value
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   jobs: Record<string, { outputs: Record<string, unknown> }>,
 *   result: Record<string, unknown>,
 *   task?: { id: string, path: string, status: string },
 * }} context
 * @returns {unknown}
 */
function renderStateMachineValue(value, context) {
  if (typeof value === 'string') {
    return renderTemplateString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderStateMachineValue(item, context));
  }

  if (isRecord(value)) {
    /** @type {Record<string, unknown>} */
    const rendered_record = {};

    for (const [key, item] of Object.entries(value)) {
      rendered_record[key] = renderStateMachineValue(item, context);
    }

    return rendered_record;
  }

  return value;
}

/**
 * @param {Array<{ condition_text: string | null, target_job_name: string }>} next_branches
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   jobs: Record<string, { outputs: Record<string, unknown> }>,
 *   result: Record<string, unknown>,
 *   task?: { id: string, path: string, status: string },
 * }} context
 * @returns {string | null}
 */
function selectStateMachineNextTarget(next_branches, context) {
  for (const next_branch of next_branches) {
    if (next_branch.condition_text === null) {
      return next_branch.target_job_name;
    }

    const matches = evaluateCondition(next_branch.condition_text, context);

    if (matches) {
      return next_branch.target_job_name;
    }
  }

  return null;
}

/**
 * @param {string} template_text
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   jobs: Record<string, { outputs: Record<string, unknown> }>,
 *   result: Record<string, unknown>,
 *   task?: { id: string, path: string, status: string },
 * }} context
 * @returns {unknown}
 */
function renderTemplateString(template_text, context) {
  const exact_expression_match = template_text.match(
    /^\s*\$\{\{\s*([\s\S]*?)\s*\}\}\s*$/u,
  );

  if (exact_expression_match !== null) {
    return evaluateExpression(exact_expression_match[1], context);
  }

  return template_text.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/gu, (_, expr) =>
    formatRenderedValue(evaluateExpression(expr, context)),
  );
}

/**
 * @param {string} condition_text
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   jobs: Record<string, { outputs: Record<string, unknown> }>,
 *   result: Record<string, unknown>,
 *   task?: { id: string, path: string, status: string },
 * }} context
 * @returns {boolean}
 */
function evaluateCondition(condition_text, context) {
  const condition_value = renderTemplateString(condition_text, context);

  if (typeof condition_value !== 'boolean') {
    throw new Error(
      `Expected state-machine next condition to evaluate to a boolean, received ${typeof condition_value}.`,
    );
  }

  return condition_value;
}

/**
 * @param {string} expression
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   jobs: Record<string, { outputs: Record<string, unknown> }>,
 *   result: Record<string, unknown>,
 *   task?: { id: string, path: string, status: string },
 * }} context
 * @returns {unknown}
 */
function evaluateExpression(expression, context) {
  return vm.runInNewContext(`(${expression})`, context, {
    timeout: 1000,
  });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatRenderedValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
