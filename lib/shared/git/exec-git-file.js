/** @import { ExecFileOptionsWithStringEncoding } from 'node:child_process' */
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);
const GIT_ENVIRONMENT_VARIABLES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
];

export { execGitFile };

/**
 * Run git without inheriting hook-scoped repository bindings.
 *
 * @param {string[]} command_arguments
 * @param {ExecFileOptionsWithStringEncoding} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function execGitFile(command_arguments, options) {
  return exec_file('git', command_arguments, {
    ...options,
    env: createGitChildEnv(options?.env),
  });
}

/**
 * @param {NodeJS.ProcessEnv | undefined} source_env
 * @returns {NodeJS.ProcessEnv}
 */
function createGitChildEnv(source_env) {
  /** @type {NodeJS.ProcessEnv} */
  const child_env = {
    ...(source_env ?? process.env),
  };

  for (const variable_name of GIT_ENVIRONMENT_VARIABLES) {
    delete child_env[variable_name];
  }

  return child_env;
}
