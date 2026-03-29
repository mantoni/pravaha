import { expect, it, vi } from 'vitest';

import { runQueueCommand } from './queue.js';

it('runs queue init with the default repo directory', async () => {
  const io_context = createIoContext();
  const initQueue = vi.fn().mockResolvedValue({
    base_ref: 'refs/queue/meta/base',
    candidate_ref: 'refs/heads/main',
    outcome: 'success',
    queue_git_dir: '/repo/.pravaha/queue.git',
    target_ref: 'refs/heads/main',
  });

  await expect(
    runQueueCommand(['init'], io_context, {
      initQueue,
    }),
  ).resolves.toBe(0);
  expect(initQueue).toHaveBeenCalledWith(process.cwd());
});

it('runs queue sync with the default repo directory', async () => {
  const io_context = createIoContext();
  const syncQueue = vi.fn().mockResolvedValue({
    outcome: 'success',
    rejected_ready_refs: [],
    resumed_runs: [],
  });

  await expect(
    runQueueCommand(['sync'], io_context, {
      syncQueue,
    }),
  ).resolves.toBe(0);
  expect(syncQueue).toHaveBeenCalledWith(process.cwd());
});

it('runs queue pull for an explicit repo directory', async () => {
  const io_context = createIoContext();
  const pullQueue = vi.fn().mockResolvedValue({
    adopted_ready_refs: [],
    outcome: 'success',
    resumed_runs: [],
  });

  await expect(
    runQueueCommand(['pull', '/repo'], io_context, {
      pullQueue,
    }),
  ).resolves.toBe(0);
  expect(pullQueue).toHaveBeenCalledWith('/repo');
});

it('runs queue publish for an explicit repo directory', async () => {
  const io_context = createIoContext();
  const publishQueue = vi.fn().mockResolvedValue({
    adopted_ready_refs: [],
    outcome: 'success',
    published_head: 'head',
    resumed_runs: [],
  });

  await expect(
    runQueueCommand(['publish', '/repo'], io_context, {
      publishQueue,
    }),
  ).resolves.toBe(0);
  expect(publishQueue).toHaveBeenCalledWith('/repo');
});

it('rejects invalid queue command shapes', async () => {
  const io_context = createIoContext();

  await expect(runQueueCommand([], io_context, {})).resolves.toBe(1);
  expect(io_context.stderr_text()).toContain(
    'Expected queue to receive <init|sync|pull|publish> [path].',
  );

  const extra_argument_io = createIoContext();

  await expect(
    runQueueCommand(['sync', '/repo', '/extra'], extra_argument_io, {}),
  ).resolves.toBe(1);
  expect(extra_argument_io.stderr_text()).toContain(
    'Expected queue to receive <init|sync|pull|publish> [path].',
  );
});

/**
 * @returns {{
 *   stderr: { write(chunk: string): boolean },
 *   stdout: { write(chunk: string): boolean },
 *   stderr_text: () => string,
 *   stdout_text: () => string,
 * }}
 */
function createIoContext() {
  let stdout = '';
  let stderr = '';

  return {
    stderr: {
      write(chunk) {
        stderr += chunk;

        return true;
      },
    },
    stdout: {
      write(chunk) {
        stdout += chunk;

        return true;
      },
    },
    stderr_text() {
      return stderr;
    },
    stdout_text() {
      return stdout;
    },
  };
}
