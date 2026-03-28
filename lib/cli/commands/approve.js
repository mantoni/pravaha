import process from 'node:process';

import { approve } from '../../pravaha.js';
import { runRuntimeCommandWithOptions } from '../runtime-command.js';

export { runApproveCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{ approve?: typeof approve }} command_context
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
