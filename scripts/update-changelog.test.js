// @module-tag integration

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import {
  extractLatestChangelogSection,
  isEntrypoint,
  isFileNotFoundError,
  normalizeGitHubRepositoryUrl,
  parseGitLogLine,
  prependReleaseSection,
  updateChangelog,
} from './update-changelog.js';

const exec_file = promisify(execFile);

it('extracts the latest changelog section', () => {
  const changelog_text = [
    '# Changelog',
    '',
    '## 0.0.1 - 2026-03-24',
    '',
    '- First release',
    '',
    '## 0.0.0 - 2026-03-23',
    '',
    '- Bootstrap',
  ].join('\n');

  expect(extractLatestChangelogSection(changelog_text)).toBe(
    ['## 0.0.1 - 2026-03-24', '', '- First release'].join('\n'),
  );
});

it('throws when the changelog does not contain a release section', () => {
  expect(() => extractLatestChangelogSection('# Changelog\n')).toThrow(
    'Expected CHANGELOG.md to contain at least one release section.',
  );
});

it('prepends a release section to an existing changelog', () => {
  const release_section = '## 0.0.1 - 2026-03-24\n\n- First release';

  expect(
    prependReleaseSection(
      '# Changelog\n\n## 0.0.0 - 2026-03-23\n',
      release_section,
    ),
  ).toContain(release_section);
});

it('creates a changelog heading when the existing file is empty or missing one', () => {
  const release_section = '## 0.0.1 - 2026-03-24\n\n- First release';

  expect(prependReleaseSection(null, release_section)).toBe(
    '# Changelog\n\n## 0.0.1 - 2026-03-24\n\n- First release\n',
  );
  expect(prependReleaseSection('Existing notes', release_section)).toContain(
    '# Changelog',
  );
});

it('normalizes ssh and https GitHub repository URLs', () => {
  expect(
    normalizeGitHubRepositoryUrl('git@github.com:mantoni/pravaha.git'),
  ).toBe('https://github.com/mantoni/pravaha');
  expect(
    normalizeGitHubRepositoryUrl('https://github.com/mantoni/pravaha.git'),
  ).toBe('https://github.com/mantoni/pravaha');
});

it('rejects non-GitHub repository URLs', () => {
  expect(() =>
    normalizeGitHubRepositoryUrl('https://example.com/repo.git'),
  ).toThrow('Expected a GitHub origin remote URL');
});

it('parses git log entries used for release notes', () => {
  expect(parseGitLogLine('abc123\tabc123\tBootstrap project')).toEqual({
    full_hash: 'abc123',
    short_hash: 'abc123',
    subject: 'Bootstrap project',
  });
});

it('rejects malformed git log entries', () => {
  expect(() => parseGitLogLine('invalid')).toThrow(
    'Unexpected git log line: invalid',
  );
});

it('updates the changelog using commits since the previous tag', async () => {
  const project_directory = await createGitProject('0.0.1');

  await writeFile(
    join(project_directory, 'CHANGELOG.md'),
    '# Changelog\n\n## 0.0.0 - 2026-03-23\n\n- Bootstrap\n',
    'utf8',
  );
  await writeFile(join(project_directory, 'README.md'), '# pravaha\n\nMore.\n');
  await runGit(project_directory, ['add', 'README.md', 'CHANGELOG.md']);
  await runGit(project_directory, ['commit', '-m', 'Add greeting']);

  await updateChangelog({
    current_date: '2026-03-24',
    project_directory,
  });

  const changelog_text = await readFile(
    join(project_directory, 'CHANGELOG.md'),
    'utf8',
  );

  expect(changelog_text).toContain('## 0.0.1 - 2026-03-24');
  expect(changelog_text).toContain('- Add greeting');
  expect(changelog_text).toContain(
    'https://github.com/mantoni/pravaha/commit/',
  );
});

it('creates a changelog from all commits when there is no previous tag', async () => {
  const project_directory = await createGitProject('0.0.1', {
    with_tag: false,
  });

  await updateChangelog({
    current_date: '2026-03-24',
    project_directory,
  });

  const changelog_text = await readFile(
    join(project_directory, 'CHANGELOG.md'),
    'utf8',
  );

  expect(changelog_text).toContain('## 0.0.1 - 2026-03-24');
  expect(changelog_text).toContain('- Bootstrap project');
});

it('throws when there are no commits to add since the previous tag', async () => {
  const project_directory = await createGitProject('0.0.1');

  await expect(
    updateChangelog({
      current_date: '2026-03-24',
      project_directory,
    }),
  ).rejects.toThrow(
    'Expected at least one commit to include in the changelog.',
  );
});

it('exposes helper predicates for file errors and entrypoint checks', () => {
  expect(isFileNotFoundError({ code: 'ENOENT' })).toBe(true);
  expect(isFileNotFoundError(new Error('boom'))).toBe(false);
  expect(isEntrypoint(import.meta.url, undefined)).toBe(false);
});

/**
 * @param {string} version
 * @param {{ with_tag?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function createGitProject(version, options = {}) {
  const project_directory = await mkdtemp(join(tmpdir(), 'pravaha-release-'));

  await writeFile(
    join(project_directory, 'package.json'),
    `${JSON.stringify({ name: 'pravaha', version }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(join(project_directory, 'README.md'), '# pravaha\n', 'utf8');
  await runGit(project_directory, ['init']);
  await runGit(project_directory, ['config', 'user.name', 'Pravaha Tests']);
  await runGit(project_directory, [
    'config',
    'user.email',
    'pravaha@example.com',
  ]);
  await runGit(project_directory, [
    'remote',
    'add',
    'origin',
    'git@github.com:mantoni/pravaha.git',
  ]);
  await runGit(project_directory, ['add', 'package.json', 'README.md']);
  await runGit(project_directory, ['commit', '-m', 'Bootstrap project']);

  if (options.with_tag !== false) {
    await runGit(project_directory, ['tag', 'v0.0.0']);
  }

  return project_directory;
}

/**
 * @param {string} project_directory
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function runGit(project_directory, args) {
  await exec_file('git', args, {
    cwd: project_directory,
  });
}
