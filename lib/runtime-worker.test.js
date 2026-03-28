/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
import { expect, it } from 'vitest';

import { createSuccessRunResult } from './runtime-test-helpers.js';
import { observeWorkerRun } from './runtime-worker.js';

it('starts a new worker thread and reports the opened thread id', async () => {
  /** @type {string | null} */
  let opened_thread_id = null;
  /** @type {$12$openai$l$codex$j$sdk.ThreadOptions | null | undefined} */
  let received_thread_options = null;

  const worker_result = await observeWorkerRun(
    {
      startThread(thread_options) {
        received_thread_options = thread_options;

        return {
          id: 'thread-start',
          async run() {
            return createSuccessRunResult();
          },
        };
      },
    },
    '/repo/.pravaha/worktrees/task',
    'Persisted prompt.',
    {
      async on_thread_opened(worker_thread_id) {
        opened_thread_id = worker_thread_id;
      },
    },
  );

  expect(worker_result).toMatchObject({
    outcome: 'success',
    worker_thread_id: 'thread-start',
  });
  expect(opened_thread_id).toBe('thread-start');
  expect(received_thread_options).toMatchObject({
    approvalPolicy: 'never',
    modelReasoningEffort: 'medium',
    sandboxMode: 'workspace-write',
    workingDirectory: '/repo/.pravaha/worktrees/task',
  });
});

it('resumes the recorded thread id when strict resume is requested', async () => {
  const worker_result = await observeWorkerRun(
    {
      startThread() {
        throw new Error('resume should not start a new thread');
      },
      resumeThread(thread_id) {
        expect(thread_id).toBe('thread-resume');

        return {
          id: null,
          async run() {
            return createSuccessRunResult();
          },
        };
      },
    },
    '/repo/.pravaha/worktrees/task',
    'Persisted prompt.',
    {
      worker_thread_id: 'thread-resume',
    },
  );

  expect(worker_result).toMatchObject({
    outcome: 'success',
    worker_thread_id: 'thread-resume',
  });
});

it('fails loudly when strict resume has no resumeThread support', async () => {
  await expect(
    observeWorkerRun(
      {
        startThread() {
          throw new Error('resume should not start a new thread');
        },
      },
      '/repo/.pravaha/worktrees/task',
      'Persisted prompt.',
      {
        worker_thread_id: 'thread-resume',
      },
    ),
  ).rejects.toThrow('Expected worker client to support resumeThread.');
});

it('normalizes non-Error worker failures', async () => {
  const worker_result = await observeWorkerRun(
    {
      startThread() {
        return {
          id: 'thread-failure',
          async run() {
            throw 'plain failure';
          },
        };
      },
    },
    '/repo/.pravaha/worktrees/task',
    'Persisted prompt.',
  );

  expect(worker_result).toMatchObject({
    outcome: 'failure',
    worker_error: 'plain failure',
    worker_thread_id: 'thread-failure',
  });
});

it('keeps a null opened thread id and normalizes Error failures', async () => {
  /** @type {string | null | undefined} */
  let opened_thread_id = undefined;

  const worker_result = await observeWorkerRun(
    {
      startThread() {
        return {
          id: null,
          async run() {
            throw new Error('explicit failure');
          },
        };
      },
    },
    '/repo/.pravaha/worktrees/task',
    'Persisted prompt.',
    {
      async on_thread_opened(worker_thread_id) {
        opened_thread_id = worker_thread_id;
      },
    },
  );

  expect(worker_result).toMatchObject({
    outcome: 'failure',
    worker_error: 'explicit failure',
    worker_thread_id: null,
  });
  expect(opened_thread_id).toBeNull();
});
