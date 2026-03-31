/* eslint-disable max-lines-per-function */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import { createRuntimePrompt } from './runtime-attempt-support.js';

it('builds the runtime prompt from contract, decisions, flow, and task documents', async () => {
  const repo_directory = await mkdtemp(
    join(tmpdir(), 'pravaha-runtime-prompt-'),
  );

  try {
    await writeRepoFile(
      repo_directory,
      'docs/contracts/runtime/demo.md',
      '# Contract\n',
    );
    await writeRepoFile(
      repo_directory,
      'docs/decisions/runtime/one.md',
      '# Decision One\n',
    );
    await writeRepoFile(
      repo_directory,
      'docs/decisions/runtime/two.md',
      '# Decision Two\n',
    );
    await writeRepoFile(
      repo_directory,
      'docs/flows/runtime/demo.js',
      '# Flow\n',
    );
    await writeRepoFile(
      repo_directory,
      'docs/tasks/runtime/demo.md',
      '# Task\n',
    );

    const prompt = await createRuntimePrompt(repo_directory, {
      contract_path: 'docs/contracts/runtime/demo.md',
      decision_paths: [
        'docs/decisions/runtime/one.md',
        'docs/decisions/runtime/two.md',
      ],
      flow_path: 'docs/flows/runtime/demo.js',
      runtime_label: 'Runtime slice',
      task_path: 'docs/tasks/runtime/demo.md',
    });

    expect(prompt).toContain('You are executing the Runtime slice.');
    expect(prompt).toContain(
      'Contract document (docs/contracts/runtime/demo.md):',
    );
    expect(prompt).toContain(
      'Decision document (docs/decisions/runtime/one.md):',
    );
    expect(prompt).toContain(
      'Decision document (docs/decisions/runtime/two.md):',
    );
    expect(prompt).toContain(
      'Root flow document (docs/flows/runtime/demo.js):',
    );
    expect(prompt).toContain('Task document (docs/tasks/runtime/demo.md):');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} repo_directory
 * @param {string} repo_path
 * @param {string} contents
 * @returns {Promise<void>}
 */
async function writeRepoFile(repo_directory, repo_path, contents) {
  const file_path = join(repo_directory, repo_path);

  await mkdir(dirname(file_path), { recursive: true });
  await writeFile(file_path, contents);
}
