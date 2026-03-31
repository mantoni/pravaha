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
      'Expected dispatch to receive [--flow <flow_instance_id> | --file <repo-path> | --prompt <text>] [path].\n',
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
         *   file_path?: string,
         *   flow_instance_id?: string,
         *   operator_io?: {
         *     stderr: { write(chunk: string): boolean },
         *     stdout: { write(chunk: string): boolean },
         *   },
         *   prompt_text?: string,
         * }} */ (runtime_options),
      ),
    {
      file_path: parsed_arguments.file_path,
      flow_instance_id: parsed_arguments.flow_instance_id,
      prompt_text: parsed_arguments.prompt_text,
    },
  );
}

/**
 * @param {string[]} command_arguments
 * @returns {{
 *   file_path?: string,
 *   flow_instance_id?: string,
 *   prompt_text?: string,
 *   repo_directory: string,
 * } | null}
 */
function parseDispatchArguments(command_arguments) {
  if (command_arguments.length === 0) {
    return {
      repo_directory: process.cwd(),
    };
  }

  const [first_argument, second_argument, third_argument] = command_arguments;

  if (isDispatchFlag(first_argument)) {
    return parseFlagDispatchArguments(
      first_argument,
      second_argument,
      third_argument,
      command_arguments.length,
    );
  }

  if (command_arguments.length > 1) {
    return null;
  }

  return {
    repo_directory: first_argument,
  };
}

/**
 * @param {string} value
 * @returns {value is '--file' | '--flow' | '--prompt'}
 */
function isDispatchFlag(value) {
  return value === '--file' || value === '--flow' || value === '--prompt';
}

/**
 * @param {'--file' | '--flow' | '--prompt'} flag
 * @param {string | undefined} dispatch_value
 * @param {string | undefined} repo_directory
 * @param {number} argument_count
 * @returns {{
 *   file_path?: string,
 *   flow_instance_id?: string,
 *   prompt_text?: string,
 *   repo_directory: string,
 * } | null}
 */
function parseFlagDispatchArguments(
  flag,
  dispatch_value,
  repo_directory,
  argument_count,
) {
  if (
    typeof dispatch_value !== 'string' ||
    dispatch_value === '' ||
    argument_count > 3
  ) {
    return null;
  }

  const normalized_repo_directory = repo_directory ?? process.cwd();

  if (flag === '--flow') {
    return {
      flow_instance_id: dispatch_value,
      repo_directory: normalized_repo_directory,
    };
  }

  if (flag === '--file') {
    return {
      file_path: dispatch_value,
      repo_directory: normalized_repo_directory,
    };
  }

  return {
    prompt_text: dispatch_value,
    repo_directory: normalized_repo_directory,
  };
}
