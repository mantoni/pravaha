/* eslint-disable max-lines */
import package_json from '../package.json' with { type: 'json' };
import process from 'node:process';

import { approve, dispatch, validateRepo, worker } from './pravaha.js';

/**
 * @param {string[]} cli_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   approve?: typeof approve,
 *   dispatch?: typeof dispatch,
 *   worker?: typeof worker,
 * }} [command_context]
 * @returns {Promise<number>}
 */
export async function main(cli_arguments, io_context, command_context = {}) {
  const [command_name] = cli_arguments;
  const command_arguments = cli_arguments.slice(1);
  const command_handler = resolveCommandHandler(
    command_name,
    command_arguments,
    io_context,
    command_context,
  );

  if (command_handler) {
    return command_handler();
  }

  io_context.stderr.write(
    `Unknown command: ${command_name}\n\n${renderHelp()}`,
  );

  return 1;
}

/**
 * @param {string | undefined} command_name
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   approve?: typeof approve,
 *   dispatch?: typeof dispatch,
 *   worker?: typeof worker,
 * }} command_context
 * @returns {(() => Promise<number>) | null}
 */
function resolveCommandHandler(
  command_name,
  command_arguments,
  io_context,
  command_context,
) {
  if (isHelpCommand(command_name)) {
    return async () => {
      io_context.stdout.write(renderHelp());

      return 0;
    };
  }

  if (isVersionCommand(command_name)) {
    return async () => {
      io_context.stdout.write(`${package_json.version}\n`);

      return 0;
    };
  }

  /** @type {Record<string, () => Promise<number>>} */
  const command_handlers = {
    approve: () =>
      runApproveCommand(command_arguments, io_context, command_context),
    dispatch: () =>
      runDispatchCommand(command_arguments, io_context, command_context),
    validate: () => runValidateCommand(command_arguments, io_context),
    worker: () =>
      runWorkerCommand(command_arguments, io_context, command_context),
  };

  if (typeof command_name !== 'string') {
    return null;
  }

  return command_handlers[command_name] ?? null;
}

/**
 * @returns {string}
 */
function renderHelp() {
  return [
    'pravaha',
    '',
    'Usage:',
    '  pravaha validate [path]',
    '  pravaha approve --token <run_id> [path]',
    '  pravaha worker [path]',
    '  pravaha dispatch [path]',
    '  pravaha version',
    '  pravaha help',
    '',
  ].join('\n');
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @returns {Promise<number>}
 */
async function runValidateCommand(command_arguments, io_context) {
  const [repo_directory = process.cwd()] = command_arguments;
  const validation_result = await validateRepo(repo_directory);

  if (validation_result.diagnostics.length === 0) {
    io_context.stdout.write(
      `Validation passed.\nChecked ${validation_result.checked_flow_count} flow document${pluralize(validation_result.checked_flow_count)}.\n`,
    );

    return 0;
  }

  io_context.stderr.write(renderValidationFailure(validation_result));

  return 1;
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   approve?: typeof approve,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runApproveCommand(
  command_arguments,
  io_context,
  command_context,
) {
  const parsed_arguments = parseApproveArguments(command_arguments);

  if (parsed_arguments === null) {
    io_context.stderr.write(
      'Expected approve to receive --token <run_id> [path].\n',
    );

    return 1;
  }

  return runRuntimeCommandWithOptions(
    parsed_arguments.repo_directory,
    io_context,
    (repo_directory, runtime_options = {}) =>
      (command_context.approve ?? approve)(
        repo_directory,
        /** @type {{
         *   operator_io?: {
         *     stderr: { write(chunk: string): boolean },
         *     stdout: { write(chunk: string): boolean },
         *   },
         *   token: string,
         * }} */ (runtime_options),
      ),
    {
      token: parsed_arguments.token,
    },
  );
}

/**
 * @param {string[]} command_arguments
 * @returns {{ repo_directory: string, token: string } | null}
 */
function parseApproveArguments(command_arguments) {
  const [flag_name, token, repo_directory = process.cwd()] = command_arguments;

  if (flag_name !== '--token' || typeof token !== 'string' || token === '') {
    return null;
  }

  return {
    repo_directory,
    token,
  };
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   worker?: typeof worker,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runWorkerCommand(
  command_arguments,
  io_context,
  command_context,
) {
  return runRuntimeCommand(
    command_arguments,
    io_context,
    command_context.worker ?? worker,
  );
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   dispatch?: typeof dispatch,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runDispatchCommand(
  command_arguments,
  io_context,
  command_context,
) {
  return runRuntimeCommand(
    command_arguments,
    io_context,
    command_context.dispatch ?? dispatch,
  );
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {(repo_directory: string) => Promise<{ outcome: string }>} runtime_command
 * @returns {Promise<number>}
 */
async function runRuntimeCommand(
  command_arguments,
  io_context,
  runtime_command,
) {
  const [repo_directory = process.cwd()] = command_arguments;

  return runRuntimeCommandWithOptions(
    repo_directory,
    io_context,
    runtime_command,
    {},
  );
}

/**
 * @param {string} repo_directory
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {(repo_directory: string, options?: Record<string, unknown>) => Promise<{ outcome: string }>} runtime_command
 * @param {Record<string, unknown>} runtime_options
 * @returns {Promise<number>}
 */
async function runRuntimeCommandWithOptions(
  repo_directory,
  io_context,
  runtime_command,
  runtime_options,
) {
  try {
    const run_result = await runtime_command(repo_directory, {
      ...runtime_options,
      operator_io: io_context,
    });
    const rendered_result = `${JSON.stringify(run_result, null, 2)}\n`;

    if (run_result.outcome === 'failure') {
      io_context.stderr.write(rendered_result);

      return 1;
    }

    io_context.stdout.write(rendered_result);

    return 0;
  } catch (error) {
    io_context.stderr.write(`${renderRuntimeFailure(error)}\n`);

    return 1;
  }
}

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
    `Validation failed.`,
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
 * @param {string | undefined} command_name
 * @returns {boolean}
 */
function isHelpCommand(command_name) {
  return (
    command_name === undefined ||
    command_name === 'help' ||
    command_name === '--help' ||
    command_name === '-h'
  );
}

/**
 * @param {string | undefined} command_name
 * @returns {boolean}
 */
function isVersionCommand(command_name) {
  return (
    command_name === 'version' ||
    command_name === '--version' ||
    command_name === '-v'
  );
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
