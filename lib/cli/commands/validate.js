import process from 'node:process';

import { validateRepo } from '../../pravaha.js';
import { pluralize, renderValidationFailure } from '../format.js';

export { runValidateCommand };

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
