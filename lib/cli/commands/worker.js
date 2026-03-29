/** @import * as $k$$k$$l$$k$$k$$l$pravaha$k$js from '../../pravaha.js'; */
import { runRuntimeCommand } from '../runtime-command.js';

export { runWorkerCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{ worker?: typeof import('../../pravaha.js').worker }} command_context
 * @returns {Promise<number>}
 */
async function runWorkerCommand(
  command_arguments,
  io_context,
  command_context = {},
) {
  const workerCommand = await resolveWorkerCommand(command_context);

  return runRuntimeCommand(command_arguments, io_context, workerCommand);
}

/**
 * @param {{ worker?: typeof import('../../pravaha.js').worker }} command_context
 * @returns {Promise<typeof $k$$k$$l$$k$$k$$l$pravaha$k$js.worker>}
 */
async function resolveWorkerCommand(command_context) {
  if (command_context.worker) {
    return command_context.worker;
  }

  const pravaha_module = await import('../../pravaha.js');

  return pravaha_module.worker;
}
