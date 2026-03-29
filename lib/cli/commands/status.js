import process from 'node:process';

import { status } from '../../pravaha.js';
import { runRuntimeCommand } from '../runtime-command.js';

export { runStatusCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{ status?: typeof status }} command_context
 * @returns {Promise<number>}
 */
async function runStatusCommand(
  command_arguments,
  io_context,
  command_context,
) {
  const parsed_arguments = parseStatusArguments(command_arguments);

  if (parsed_arguments === null) {
    io_context.stderr.write('Expected status to receive [path].\n');

    return 1;
  }

  return runRuntimeCommand(
    [parsed_arguments.repo_directory],
    io_context,
    (repo_directory) => (command_context.status ?? status)(repo_directory),
  );
}

/**
 * @param {string[]} command_arguments
 * @returns {{ repo_directory: string } | null}
 */
function parseStatusArguments(command_arguments) {
  if (command_arguments.length > 1) {
    return null;
  }

  return {
    repo_directory: command_arguments[0] ?? process.cwd(),
  };
}
