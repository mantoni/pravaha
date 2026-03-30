export {
  createDispatchResult,
  createIoContext,
  createStatusResult,
  createStoppedWorkerResult,
  createSuccessfulValidationResult,
};

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout_text: () => string,
 * }}
 */
function createIoContext() {
  let stdout = '';
  let stderr = '';

  return {
    stderr: {
      write(chunk) {
        stderr += chunk;

        return true;
      },
    },
    stdout: {
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stderr_text() {
      return stderr;
    },
    stdout_text() {
      return stdout;
    },
  };
}

/**
 * @returns {{
 *   dispatcher_available: false,
 *   dispatcher_id: null,
 *   endpoint: string,
 *   notification_delivered: false,
 *   outcome: 'success',
 * }}
 */
function createDispatchResult() {
  return {
    dispatcher_available: false,
    dispatcher_id: null,
    endpoint: '/repo/.pravaha/dispatcher.sock',
    notification_delivered: false,
    outcome: 'success',
  };
}

/**
 * @returns {{
 *   connected_worker_count: number,
 *   dispatcher_available: false,
 *   dispatcher_id: null,
 *   endpoint: string,
 *   flows_by_status: {
 *     failed: never[],
 *     pending: never[],
 *     running: never[],
 *     succeeded: never[],
 *     'waiting-approval': never[],
 *     'waiting-queue': never[],
 *   },
 *   outcome: 'success',
 * }}
 */
function createStatusResult() {
  return {
    connected_worker_count: 0,
    dispatcher_available: false,
    dispatcher_id: null,
    endpoint: '/repo/.pravaha/dispatcher.sock',
    flows_by_status: {
      failed: [],
      pending: [],
      running: [],
      succeeded: [],
      'waiting-approval': [],
      'waiting-queue': [],
    },
    outcome: 'success',
  };
}

/**
 * @returns {{ checked_flow_count: number, diagnostics: never[] }}
 */
function createSuccessfulValidationResult() {
  return {
    checked_flow_count: 1,
    diagnostics: [],
  };
}

/**
 * @returns {{
 *   dispatcher_id: string,
 *   endpoint: string,
 *   outcome: 'stopped',
 *   role: 'dispatcher',
 *   worker_id: string,
 * }}
 */
function createStoppedWorkerResult() {
  return {
    dispatcher_id: 'worker-explicit',
    endpoint: '/repo/.pravaha/dispatcher.sock',
    outcome: 'stopped',
    role: 'dispatcher',
    worker_id: 'worker-explicit',
  };
}
