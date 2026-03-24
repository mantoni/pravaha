/* eslint-disable max-lines */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec_file = promisify(execFile);

if (isEntrypoint(import.meta.url, process.argv[1])) {
  await main();
}

export {
  extractLatestChangelogSection,
  isEntrypoint,
  isFileNotFoundError,
  normalizeGitHubRepositoryUrl,
  parseGitLogLine,
  prependReleaseSection,
  updateChangelog,
};

/**
 * @typedef {{
 *   full_hash: string,
 *   short_hash: string,
 *   subject: string,
 * }} CommitEntry
 */

/**
 * @param {{
 *   current_date?: string,
 *   project_directory?: string,
 * }} [options]
 */
async function updateChangelog(options = {}) {
  const current_date =
    options.current_date ?? new Date().toISOString().slice(0, 10);
  const project_directory = options.project_directory ?? process.cwd();
  const package_json = await readPackageJson(project_directory);
  const previous_tag = await findPreviousTag(project_directory);
  const commit_entries = await listCommitEntries(
    project_directory,
    previous_tag,
  );

  if (commit_entries.length === 0) {
    throw new Error(
      'Expected at least one commit to include in the changelog.',
    );
  }

  const repository_url = normalizeGitHubRepositoryUrl(
    await readOriginRemoteUrl(project_directory),
  );
  const release_section = renderReleaseSection({
    commit_entries,
    current_date,
    repository_url,
    version: package_json.version,
  });
  const changelog_path = join(project_directory, 'CHANGELOG.md');
  const existing_changelog = await readOptionalTextFile(changelog_path);
  const next_changelog = prependReleaseSection(
    existing_changelog,
    release_section,
  );

  await writeFile(changelog_path, next_changelog);
}

/**
 * @param {string} changelog_text
 * @returns {string}
 */
function extractLatestChangelogSection(changelog_text) {
  const changelog_lines = changelog_text.split('\n');
  const first_section_index = changelog_lines.findIndex((line) =>
    line.startsWith('## '),
  );

  if (first_section_index === -1) {
    throw new Error(
      'Expected CHANGELOG.md to contain at least one release section.',
    );
  }

  const next_section_index = changelog_lines.findIndex(
    (line, line_index) =>
      line_index > first_section_index && line.startsWith('## '),
  );
  const section_lines = changelog_lines.slice(
    first_section_index,
    next_section_index === -1 ? changelog_lines.length : next_section_index,
  );

  return section_lines.join('\n').trim();
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  await updateChangelog();
}

/**
 * @param {string} project_directory
 * @returns {Promise<{ version: string }>}
 */
async function readPackageJson(project_directory) {
  const package_json_path = join(project_directory, 'package.json');
  const package_json_text = await readFile(package_json_path, 'utf8');
  const package_json = JSON.parse(package_json_text);

  if (
    typeof package_json.version !== 'string' ||
    package_json.version.length === 0
  ) {
    throw new Error('Expected package.json to define a version string.');
  }

  return package_json;
}

/**
 * @param {string} project_directory
 * @returns {Promise<string | null>}
 */
async function findPreviousTag(project_directory) {
  const git_tag_text = await execGit(project_directory, [
    'tag',
    '--merged',
    'HEAD',
    '--sort=-version:refname',
  ]);
  const tag_names = git_tag_text
    .split('\n')
    .map((tag_name) => tag_name.trim())
    .filter(Boolean);

  return tag_names[0] ?? null;
}

/**
 * @param {string} project_directory
 * @param {string | null} previous_tag
 * @returns {Promise<CommitEntry[]>}
 */
async function listCommitEntries(project_directory, previous_tag) {
  const git_log_args = ['log', '--pretty=format:%H%x09%h%x09%s'];

  if (previous_tag) {
    git_log_args.push(`${previous_tag}..HEAD`);
  }

  const git_log_text = await execGit(project_directory, git_log_args);

  if (git_log_text.trim().length === 0) {
    return [];
  }

  return git_log_text.split('\n').filter(Boolean).map(parseGitLogLine);
}

/**
 * @param {string} project_directory
 * @returns {Promise<string>}
 */
async function readOriginRemoteUrl(project_directory) {
  return execGit(project_directory, ['remote', 'get-url', 'origin']);
}

/**
 * @param {string} remote_url
 * @returns {string}
 */
function normalizeGitHubRepositoryUrl(remote_url) {
  const trimmed_url = remote_url.trim();
  const ssh_match = trimmed_url.match(/^git@github\.com:(.+?)(?:\.git)?$/u);

  if (ssh_match) {
    return `https://github.com/${ssh_match[1]}`;
  }

  const https_match = trimmed_url.match(
    /^https:\/\/github\.com\/(.+?)(?:\.git)?$/u,
  );

  if (https_match) {
    return `https://github.com/${https_match[1]}`;
  }

  throw new Error(
    `Expected a GitHub origin remote URL, received: ${trimmed_url}`,
  );
}

/**
 * @param {{
 *   commit_entries: CommitEntry[],
 *   current_date: string,
 *   repository_url: string,
 *   version: string,
 * }} options
 * @returns {string}
 */
function renderReleaseSection(options) {
  const entry_lines = options.commit_entries.map((commit_entry) =>
    renderCommitEntry(commit_entry, options.repository_url),
  );

  return `## ${options.version} - ${options.current_date}\n\n${entry_lines.join('\n')}`;
}

/**
 * @param {CommitEntry} commit_entry
 * @param {string} repository_url
 * @returns {string}
 */
function renderCommitEntry(commit_entry, repository_url) {
  return (
    `- ${commit_entry.subject}\n` +
    `  ([\`${commit_entry.short_hash}\`](${repository_url}/commit/${commit_entry.full_hash}))`
  );
}

/**
 * @param {string | null} existing_changelog
 * @param {string} release_section
 * @returns {string}
 */
function prependReleaseSection(existing_changelog, release_section) {
  const trimmed_changelog = existing_changelog?.trim() ?? '';

  if (trimmed_changelog.length === 0) {
    return ['# Changelog', '', release_section, ''].join('\n');
  }

  if (trimmed_changelog.startsWith('# Changelog')) {
    const existing_sections = trimmed_changelog
      .slice('# Changelog'.length)
      .trim();

    if (existing_sections.length === 0) {
      return ['# Changelog', '', release_section, ''].join('\n');
    }

    return ['# Changelog', '', release_section, '', existing_sections, ''].join(
      '\n',
    );
  }

  return ['# Changelog', '', release_section, '', trimmed_changelog, ''].join(
    '\n',
  );
}

/**
 * @param {string} file_path
 * @returns {Promise<string | null>}
 */
async function readOptionalTextFile(file_path) {
  try {
    return await readFile(file_path, 'utf8');
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * @param {string} git_log_line
 * @returns {CommitEntry}
 */
function parseGitLogLine(git_log_line) {
  const [full_hash, short_hash, subject] = git_log_line.split('\t');

  if (!full_hash || !short_hash || !subject) {
    throw new Error(`Unexpected git log line: ${git_log_line}`);
  }

  return {
    full_hash,
    short_hash,
    subject,
  };
}

/**
 * @param {string} project_directory
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function execGit(project_directory, args) {
  const { stdout } = await exec_file('git', args, {
    cwd: project_directory,
  });

  return stdout.trim();
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isFileNotFoundError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/**
 * @param {string} module_url
 * @param {string | undefined} argv_path
 * @returns {boolean}
 */
function isEntrypoint(module_url, argv_path) {
  if (!argv_path) {
    return false;
  }

  return module_url === pathToFileURL(argv_path).href;
}
