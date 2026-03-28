import package_json from '../../package.json' with { type: 'json' };

import { runApproveCommand } from './commands/approve.js';
import { runDispatchCommand } from './commands/dispatch.js';
import { runValidateCommand } from './commands/validate.js';
import { runWorkerCommand } from './commands/worker.js';
import { isHelpCommand, isVersionCommand, renderHelp } from './help.js';

export { main };

/**
 * @param {string[]} cli_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   approve?: import('../pravaha.js').approve,
 *   dispatch?: import('../pravaha.js').dispatch,
 *   worker?: import('../pravaha.js').worker,
 * }} [command_context]
 * @returns {Promise<number>}
 */
async function main(cli_arguments, io_context, command_context = {}) {
  const [command_name] = cli_arguments;
  const command_arguments = cli_arguments.slice(1);
  const command_handler = resolveCommandHandler(
    command_name,
    command_arguments,
    io_context,
    command_context,
  );

  if (command_handler) {
    return command_handler();
  }

  io_context.stderr.write(
    `Unknown command: ${command_name}\n\n${renderHelp()}`,
  );

  return 1;
}

/**
 * @param {string | undefined} command_name
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   approve?: import('../pravaha.js').approve,
 *   dispatch?: import('../pravaha.js').dispatch,
 *   worker?: import('../pravaha.js').worker,
 * }} command_context
 * @returns {(() => Promise<number>) | null}
 */
function resolveCommandHandler(
  command_name,
  command_arguments,
  io_context,
  command_context,
) {
  if (isHelpCommand(command_name)) {
    return async () => {
      io_context.stdout.write(renderHelp());

      return 0;
    };
  }

  if (isVersionCommand(command_name)) {
    return async () => {
      io_context.stdout.write(`${package_json.version}\n`);

      return 0;
    };
  }

  /** @type {Record<string, () => Promise<number>>} */
  const command_handlers = {
    approve: () =>
      runApproveCommand(command_arguments, io_context, command_context),
    dispatch: () =>
      runDispatchCommand(command_arguments, io_context, command_context),
    validate: () => runValidateCommand(command_arguments, io_context),
    worker: () =>
      runWorkerCommand(command_arguments, io_context, command_context),
  };

  if (typeof command_name !== 'string') {
    return null;
  }

  return command_handlers[command_name] ?? null;
}
