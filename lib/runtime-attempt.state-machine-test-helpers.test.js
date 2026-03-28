import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { FLOW_PATH } from './reconcile.fixture-test-helpers.js';
import {
  createStateMachineFixtureRepo,
  createStateMachinePreamble,
} from './runtime-attempt.state-machine-test-helpers.js';

it('returns the checked-in state-machine preamble', () => {
  expect(createStateMachinePreamble()).toEqual(
    expect.arrayContaining([
      'kind: flow',
      'id: single-task-flow-reconciler',
      'jobs:',
    ]),
  );
});

it('creates the default state-machine fixture repo when no yaml lines are provided', async () => {
  const repo_directory = await createStateMachineFixtureRepo();

  try {
    const flow_document_text = await readFile(
      join(repo_directory, FLOW_PATH),
      'utf8',
    );

    expect(flow_document_text).toContain('id: single-task-flow-reconciler');
    expect(flow_document_text).toContain('next: done');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('accepts object and array yaml-line overrides for fixture repos', async () => {
  const object_repo_directory = await createStateMachineFixtureRepo({
    yaml_lines: [
      ...createStateMachinePreamble(),
      '  review:',
      '    end: success',
    ],
  });
  const array_repo_directory = await createStateMachineFixtureRepo([
    ...createStateMachinePreamble(),
    '  finalize:',
    '    end: failure',
  ]);

  try {
    const object_flow_document_text = await readFile(
      join(object_repo_directory, FLOW_PATH),
      'utf8',
    );
    const array_flow_document_text = await readFile(
      join(array_repo_directory, FLOW_PATH),
      'utf8',
    );

    expect(object_flow_document_text).toContain('  review:');
    expect(array_flow_document_text).toContain('  finalize:');
  } finally {
    await rm(object_repo_directory, { force: true, recursive: true });
    await rm(array_repo_directory, { force: true, recursive: true });
  }
});
