import { expect, it, vi } from 'vitest';

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

const { default: git_status_plugin } = await import('./git-status.js');

it('returns a clean git status when porcelain output is empty', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'abc123\n' })
    .mockResolvedValueOnce({ stdout: '\n' });

  await expect(git_status_plugin.run(createContext())).resolves.toEqual({
    dirty: false,
    head: 'abc123',
  });
});

it('returns a dirty git status when porcelain output contains changes', async () => {
  execGitFile
    .mockResolvedValueOnce({ stdout: 'def456\n' })
    .mockResolvedValueOnce({ stdout: ' M demo.txt\n' });

  await expect(git_status_plugin.run(createContext())).resolves.toEqual({
    dirty: true,
    head: 'def456',
  });
});

function createContext() {
  return {
    console: {
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
    dispatchFlow: vi.fn(),
    doc: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
    failRun: vi.fn(),
    repo_directory: '/repo',
    requestApproval: vi.fn(),
    requestQueueWait: vi.fn(),
    run_id: 'run:demo',
    with: undefined,
    worktree_path: '/tmp/worktree',
  };
}
