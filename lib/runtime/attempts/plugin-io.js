export {
  createPluginConsole,
  readRequiredRunId,
  readSignalSubjects,
  resolveOperatorIo,
  writeApprovalInstruction,
};

const NOOP_OPERATOR_IO = {
  stderr: {
    write() {
      return true;
    },
  },
  stdout: {
    write() {
      return true;
    },
  },
};

/**
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }}
 */
function resolveOperatorIo(operator_io) {
  if (operator_io !== undefined) {
    return operator_io;
  }

  return NOOP_OPERATOR_IO;
}

/**
 * @param {{ write(chunk: string): boolean }} stdout
 * @param {string} run_id
 * @returns {void}
 */
function writeApprovalInstruction(stdout, run_id) {
  stdout.write(
    `Approval requested. Run \`pravaha approve --token ${run_id}\` to continue.\n`,
  );
}

/**
 * @param {{
 *   document?: { id: string, path: string, status: string },
 *   task: { id: string, path: string, status: string },
 * }} binding_targets
 * @returns {('document' | 'task')[]}
 */
function readSignalSubjects(binding_targets) {
  /** @type {('document' | 'task')[]} */
  const signal_subjects = [];

  if (binding_targets.document !== undefined) {
    signal_subjects.push('document');
  }

  if (binding_targets.task !== undefined) {
    signal_subjects.push('task');
  }

  /* istanbul ignore next -- state-machine attempts require a task binding before plugin execution can run */
  if (signal_subjects.length === 0) {
    throw new Error(
      'Expected plugin signal subjects to come from run bindings.',
    );
  }

  return signal_subjects;
}

/**
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * }} operator_io
 * @returns {{
 *   error: (...values: unknown[]) => void,
 *   info: (...values: unknown[]) => void,
 *   log: (...values: unknown[]) => void,
 *   warn: (...values: unknown[]) => void,
 * }}
 */
function createPluginConsole(operator_io) {
  return {
    error(...values) {
      operator_io.stderr.write(`${formatConsoleMessage(values)}\n`);
    },
    info(...values) {
      operator_io.stdout.write(`${formatConsoleMessage(values)}\n`);
    },
    log(...values) {
      operator_io.stdout.write(`${formatConsoleMessage(values)}\n`);
    },
    warn(...values) {
      operator_io.stderr.write(`${formatConsoleMessage(values)}\n`);
    },
  };
}

/**
 * @param {string | undefined} run_id
 * @returns {string}
 */
function readRequiredRunId(run_id) {
  if (typeof run_id !== 'string' || run_id.trim() === '') {
    throw new Error('Expected a stable run id for plugin execution.');
  }

  return run_id;
}

/**
 * @param {unknown[]} values
 * @returns {string}
 */
function formatConsoleMessage(values) {
  return values.map((value) => formatConsoleValue(value)).join(' ');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatConsoleValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}
