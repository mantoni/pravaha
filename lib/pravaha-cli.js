import package_json from '../package.json' with { type: 'json' };
import process from 'node:process';

import { validateRepo } from './pravaha.js';

/**
 * @param {string[]} cli_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @returns {Promise<number>}
 */
export async function main(cli_arguments, io_context) {
  const [command_name] = cli_arguments;

  if (
    command_name === undefined ||
    command_name === 'help' ||
    command_name === '--help' ||
    command_name === '-h'
  ) {
    io_context.stdout.write(renderHelp());

    return 0;
  }

  if (
    command_name === 'version' ||
    command_name === '--version' ||
    command_name === '-v'
  ) {
    io_context.stdout.write(`${package_json.version}\n`);

    return 0;
  }

  if (command_name === 'validate') {
    return runValidateCommand(cli_arguments.slice(1), io_context);
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
    '  pravaha greet [name]',
    '  pravaha validate [path]',
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
 * @param {number} count
 * @returns {string}
 */
function pluralize(count) {
  if (count === 1) {
    return '';
  }

  return 's';
}
