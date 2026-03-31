/** @import { GraphNode } from '../../shared/types/patram-types.ts' */
/* eslint-disable max-lines, jsdoc/prefer-import-tag */
import process from 'node:process';

export {
  DISPATCH_RUNTIME_LABEL,
  createCurrentDate,
  createSharedSessionContext,
  createStopContext,
  createWorkerId,
  createWorkerSignalContext,
  formatDiagnostics,
  isTransientFollowerRegistrationError,
  pluralize,
  readAssignmentExecutionContext,
  readErrorMessage,
  readRequiredNodeId,
  readRequiredNodePath,
  readRequiredNodeStatus,
  registerAbort,
  waitForRetryInterval,
};

const DISPATCH_RUNTIME_LABEL = 'Pravaha local dispatch runtime slice';
const FOLLOWER_RETRY_INTERVAL_MS = 10;

/**
 * @param {unknown[]} diagnostics
 * @returns {string}
 */
function formatDiagnostics(diagnostics) {
  const resolved_diagnostics = /** @type {Array<{
   *   file_path?: string,
   *   message: string,
   *   path?: string,
   * }>} */ (diagnostics);

  return resolved_diagnostics
    .map(
      /**
       * @param {{ file_path?: string, message: string, path?: string }} diagnostic
       * @returns {string}
       */
      (diagnostic) =>
        `${diagnostic.path ?? diagnostic.file_path ?? '<unknown>'}: ${diagnostic.message}`,
    )
    .join('\n');
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeId(node, label) {
  if (typeof node.$id !== 'string') {
    throw new Error(`Expected ${label} to expose a Patram id.`);
  }

  return node.$id;
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodePath(node, label) {
  if (typeof node.$path !== 'string') {
    throw new Error(`Expected ${label} to expose a path.`);
  }

  return node.$path;
}

/**
 * @param {GraphNode} node
 * @param {string} label
 * @returns {string}
 */
function readRequiredNodeStatus(node, label) {
  if (typeof node.status !== 'string') {
    throw new Error(`Expected ${label} to expose a status.`);
  }

  return node.status;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function readErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api?: {
 *     load_project_graph: (repo_directory: string) => Promise<import('../../shared/types/patram-types.ts').ProjectGraphResult>,
 *     query_graph: import('../../shared/types/patram-types.ts').GraphApi['query_graph'],
 *   },
 *   log_to_operator: (line: string) => void,
 *   now?: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory?: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: Record<string, unknown>,
 * }} shared_context
 * @returns {{
 *   graph_api: {
 *     load_project_graph: (repo_directory: string) => Promise<import('../../shared/types/patram-types.ts').ProjectGraphResult>,
 *     query_graph: import('../../shared/types/patram-types.ts').GraphApi['query_graph'],
 *   },
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory: string,
 *   worker_client?: Record<string, unknown>,
 * }}
 */
function readAssignmentExecutionContext(shared_context) {
  if (
    shared_context.graph_api === undefined ||
    shared_context.now === undefined ||
    typeof shared_context.repo_directory !== 'string'
  ) {
    throw new Error('Expected assignment execution context to be fully bound.');
  }

  return {
    graph_api: shared_context.graph_api,
    now: shared_context.now,
    operator_io: shared_context.operator_io,
    repo_directory: shared_context.repo_directory,
    worker_client: shared_context.worker_client,
  };
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {{
 *   cleanup: () => Promise<void>,
 *   signal?: AbortSignal,
 * }}
 */
function createWorkerSignalContext(signal) {
  if (signal) {
    return {
      cleanup() {
        return Promise.resolve();
      },
      signal,
    };
  }

  const abort_controller = new globalThis.AbortController();
  const abortWorker = () => {
    abort_controller.abort();
  };

  process.once('SIGINT', abortWorker);
  process.once('SIGTERM', abortWorker);

  return {
    cleanup() {
      process.off('SIGINT', abortWorker);
      process.off('SIGTERM', abortWorker);

      return Promise.resolve();
    },
    signal: abort_controller.signal,
  };
}

/**
 * @param {string} endpoint
 * @param {((event: Record<string, unknown>) => void | Promise<void>) | undefined} on_event
 * @param {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 * } | undefined} operator_io
 * @param {AbortSignal | undefined} signal
 * @param {string} worker_id
 * @param {{
 *   load_project_graph: (repo_directory: string) => Promise<import('../../shared/types/patram-types.ts').ProjectGraphResult>,
 *   query_graph: import('../../shared/types/patram-types.ts').GraphApi['query_graph'],
 * }} graph_api
 * @param {string} repo_directory
 * @param {Record<string, unknown> | undefined} worker_client
 * @param {() => Date} now
 * @returns {{
 *   emit_event: (event: Record<string, unknown>) => Promise<void>,
 *   endpoint: string,
 *   graph_api: {
 *     load_project_graph: (repo_directory: string) => Promise<import('../../shared/types/patram-types.ts').ProjectGraphResult>,
 *     query_graph: import('../../shared/types/patram-types.ts').GraphApi['query_graph'],
 *   },
 *   log_to_operator: (line: string) => void,
 *   now: () => Date,
 *   operator_io?: {
 *     stderr: { write(chunk: string): boolean },
 *     stdout: { write(chunk: string): boolean },
 *   },
 *   repo_directory: string,
 *   signal?: AbortSignal,
 *   worker_id: string,
 *   worker_client?: Record<string, unknown>,
 * }}
 */
function createSharedSessionContext(
  endpoint,
  on_event,
  operator_io,
  signal,
  worker_id,
  graph_api,
  repo_directory,
  worker_client,
  now,
) {
  return {
    async emit_event(event) {
      if (typeof on_event === 'function') {
        await on_event({
          ...event,
          endpoint,
        });
      }
    },
    endpoint,
    graph_api,
    log_to_operator(line) {
      operator_io?.stdout.write(`${line}\n`);
    },
    now,
    operator_io,
    repo_directory,
    signal,
    worker_id,
    worker_client,
  };
}

/**
 * @returns {{
 *   resolve: () => void,
 *   stopped: Promise<void>,
 *   stopped_requested: boolean,
 * }}
 */
function createStopContext() {
  /** @type {(value?: void | PromiseLike<void>) => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const stopped = new Promise((resolve_stop) => {
    resolve = resolve_stop;
  });

  return {
    resolve() {
      resolve();
    },
    stopped,
    stopped_requested: false,
  };
}

/**
 * @param {AbortSignal | undefined} signal
 * @param {() => Promise<void>} stop
 * @returns {void}
 */
function registerAbort(signal, stop) {
  signal?.addEventListener(
    'abort',
    () => {
      void stop();
    },
    {
      once: true,
    },
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientFollowerRegistrationError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message ===
      'Expected a live dispatcher to accept follower registration.' ||
    error.message ===
      'Expected the dispatcher to acknowledge worker registration.'
  );
}

/**
 * @returns {Promise<void>}
 */
async function waitForRetryInterval() {
  await new Promise((resolve_retry) => {
    globalThis.setTimeout(resolve_retry, FOLLOWER_RETRY_INTERVAL_MS);
  });
}

/**
 * @returns {string}
 */
function createWorkerId() {
  return `worker-${process.pid}-${Date.now().toString(36)}`;
}

/**
 * @returns {Date}
 */
function createCurrentDate() {
  return new Date();
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
