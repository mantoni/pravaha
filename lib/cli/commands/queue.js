import process from 'node:process';

import {
  initQueue,
  pullQueue,
  publishQueue,
  syncQueue,
} from '../../pravaha.js';
import { runRuntimeCommandWithOptions } from '../runtime-command.js';

export { runQueueCommand };

/**
 * @param {string[]} command_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @param {{
 *   initQueue?: typeof initQueue,
 *   pullQueue?: typeof pullQueue,
 *   publishQueue?: typeof publishQueue,
 *   syncQueue?: typeof syncQueue,
 * }} command_context
 * @returns {Promise<number>}
 */
async function runQueueCommand(command_arguments, io_context, command_context) {
  const parsed_arguments = parseQueueArguments(command_arguments);

  if (parsed_arguments === null) {
    io_context.stderr.write(
      'Expected queue to receive <init|sync|pull|publish> [path].\n',
    );

    return 1;
  }

  return runRuntimeCommandWithOptions(
    parsed_arguments.repo_directory,
    io_context,
    resolveQueueRuntimeCommand(parsed_arguments.subcommand, command_context),
    {},
  );
}

/**
 * @param {'init' | 'publish' | 'pull' | 'sync'} subcommand
 * @param {{
 *   initQueue?: typeof initQueue,
 *   pullQueue?: typeof pullQueue,
 *   publishQueue?: typeof publishQueue,
 *   syncQueue?: typeof syncQueue,
 * }} command_context
 * @returns {(repo_directory: string) => Promise<{ outcome: string }>}
 */
function resolveQueueRuntimeCommand(subcommand, command_context) {
  if (subcommand === 'init') {
    return (repo_directory) =>
      (command_context.initQueue ?? initQueue)(repo_directory);
  }

  if (subcommand === 'pull') {
    return (repo_directory) =>
      (command_context.pullQueue ?? pullQueue)(repo_directory);
  }

  if (subcommand === 'publish') {
    return (repo_directory) =>
      (command_context.publishQueue ?? publishQueue)(repo_directory);
  }

  return (repo_directory) =>
    (command_context.syncQueue ?? syncQueue)(repo_directory);
}

/**
 * @param {string[]} command_arguments
 * @returns {{ repo_directory: string, subcommand: 'init' | 'publish' | 'pull' | 'sync' } | null}
 */
function parseQueueArguments(command_arguments) {
  const [subcommand, repo_directory = process.cwd()] = command_arguments;

  if (
    subcommand !== 'init' &&
    subcommand !== 'pull' &&
    subcommand !== 'publish' &&
    subcommand !== 'sync'
  ) {
    return null;
  }

  if (command_arguments.length > 2) {
    return null;
  }

  return {
    repo_directory,
    subcommand,
  };
}
