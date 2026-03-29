import { execGitFile } from '../../shared/git/exec-git-file.js';

export { readLogSubjects, readRevision };

/**
 * @param {string} repo_directory
 * @param {string} revision
 * @returns {Promise<string>}
 */
async function readRevision(repo_directory, revision) {
  const { stdout } = await execGitFile(['rev-parse', revision], {
    cwd: repo_directory,
    encoding: 'utf8',
  });

  return stdout.trim();
}

/**
 * @param {string} repo_directory
 * @param {string} revision_range
 * @returns {Promise<string[]>}
 */
async function readLogSubjects(repo_directory, revision_range) {
  const { stdout } = await execGitFile(
    ['log', '--format=%s', '--reverse', revision_range],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );
  const trimmed_stdout = stdout.trim();

  if (trimmed_stdout === '') {
    return [];
  }

  return trimmed_stdout.split('\n');
}
