import package_json from '../package.json' with { type: 'json' };
import process from 'node:process';

import { reconcile, runHappyPath, validateRepo } from './pravaha.js';

/**
 * @param {string[]} cli_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   reconcile?: typeof reconcile,
 *   run_happy_path?: typeof runHappyPath,
 * }} [command_context]
 * @returns {Promise<number>}
 */
export async function main(cli_arguments, io_context, command_context = {}) {
  const [command_name] = cli_arguments;
  const command_arguments = cli_arguments.slice(1);

  if (isHelpCommand(command_name)) {
    io_context.stdout.write(renderHelp());

    return 0;
  }

  if (isVersionCommand(command_name)) {
    io_context.stdout.write(`${package_json.version}\n`);

    return 0;
  }

  if (command_name === 'validate') {
    return runValidateCommand(command_arguments, io_context);
  }

  if (command_name === 'run-happy-path') {
    return runHappyPathCommand(command_arguments, io_context, command_context);
  }

  if (command_name === 'reconcile') {
    return runReconcileCommand(command_arguments, io_context, command_context);
  }

  io_context.stderr.write(
    `Unknown command: ${command_name}\n\n${renderHelp()}`,
  );

  return 1;
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
    '  pravaha run-happy-path [path]',
    '  pravaha reconcile [path]',
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
 *   reconcile?: typeof reconcile,
 *   run_happy_path?: typeof runHappyPath,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runHappyPathCommand(
  command_arguments,
  io_context,
  command_context,
) {
  return runRuntimeCommand(
    command_arguments,
    io_context,
    command_context.run_happy_path ?? runHappyPath,
  );
}

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   reconcile?: typeof reconcile,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runReconcileCommand(
  command_arguments,
  io_context,
  command_context,
) {
  return runRuntimeCommand(
    command_arguments,
    io_context,
    command_context.reconcile ?? reconcile,
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

  try {
    const run_result = await runtime_command(repo_directory);
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
