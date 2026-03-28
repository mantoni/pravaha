import { worker } from '../../pravaha.js';
import { runRuntimeCommand } from '../runtime-command.js';

export { runWorkerCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{ worker?: typeof worker }} command_context
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
