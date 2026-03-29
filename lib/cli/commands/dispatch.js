import process from 'node:process';

import { dispatch } from '../../pravaha.js';
import { runRuntimeCommandWithOptions } from '../runtime-command.js';

export { runDispatchCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{ dispatch?: typeof dispatch }} command_context
 * @returns {Promise<number>}
 */
async function runDispatchCommand(
  command_arguments,
  io_context,
  command_context,
) {
  const parsed_arguments = parseDispatchArguments(command_arguments);

  if (parsed_arguments === null) {
    io_context.stderr.write(
      'Expected dispatch to receive [--flow <flow_instance_id>] [path].\n',
    );

    return 1;
  }

  return runRuntimeCommandWithOptions(
    parsed_arguments.repo_directory,
    io_context,
    (repo_directory, runtime_options = {}) =>
      (command_context.dispatch ?? dispatch)(
        repo_directory,
        /** @type {{
         *   flow_instance_id?: string,
         *   operator_io?: {
         *     stderr: { write(chunk: string): boolean },
         *     stdout: { write(chunk: string): boolean },
         *   },
         * }} */ (runtime_options),
      ),
    {
      flow_instance_id: parsed_arguments.flow_instance_id,
    },
  );
}

/**
 * @param {string[]} command_arguments
 * @returns {{ flow_instance_id?: string, repo_directory: string } | null}
 */
function parseDispatchArguments(command_arguments) {
  if (command_arguments.length === 0) {
    return {
      repo_directory: process.cwd(),
    };
  }

  const [first_argument, second_argument, third_argument] = command_arguments;

  if (first_argument === '--flow') {
    if (
      typeof second_argument !== 'string' ||
      second_argument === '' ||
      command_arguments.length > 3
    ) {
      return null;
    }

    return {
      flow_instance_id: second_argument,
      repo_directory: third_argument ?? process.cwd(),
    };
  }

  if (command_arguments.length > 1) {
    return null;
  }

  return {
    repo_directory: first_argument,
  };
}
