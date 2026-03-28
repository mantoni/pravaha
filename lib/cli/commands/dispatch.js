import { dispatch } from '../../pravaha.js';
import { runRuntimeCommand } from '../runtime-command.js';

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
  return runRuntimeCommand(
    command_arguments,
    io_context,
    command_context.dispatch ?? dispatch,
  );
}
