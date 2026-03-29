import { beforeEach, expect, it, vi } from 'vitest';

const { execGitFile } = vi.hoisted(() => {
  return {
    execGitFile: vi.fn(),
  };
});

vi.mock('../../shared/git/exec-git-file.js', () => {
  return {
    execGitFile,
  };
});

const { readLogSubjects, readRevision } = await import('./test-git-helpers.js');

beforeEach(() => {
  execGitFile.mockReset();
});

it('reads and trims revisions', async () => {
  execGitFile.mockResolvedValueOnce({ stdout: 'head-sha\n' });

  await expect(readRevision('/tmp/repo', 'HEAD')).resolves.toBe('head-sha');
});

it('returns an empty subject list when the git log is empty', async () => {
  execGitFile.mockResolvedValueOnce({ stdout: '\n' });

  await expect(readLogSubjects('/tmp/repo', 'main..main')).resolves.toEqual([]);
});
