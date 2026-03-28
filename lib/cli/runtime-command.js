import process from 'node:process';

import { renderRuntimeFailure } from './format.js';

export { runRuntimeCommand, runRuntimeCommandWithOptions };

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
