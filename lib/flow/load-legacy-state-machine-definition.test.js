import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { loadLegacyStateMachineDefinition } from './load-legacy-state-machine-definition.js';

it('loads a valid legacy yaml state-machine flow definition', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const flow_file_path = join(temp_directory, 'flow.yaml');

  try {
    await writeFile(
      flow_file_path,
      ['jobs:', '  done:', '    end: success', ''].join('\n'),
      'utf8',
    );

    await expect(
      loadLegacyStateMachineDefinition(flow_file_path),
    ).resolves.toEqual({
      diagnostics: [],
      flow_definition: {
        jobs: {
          done: {
            end: 'success',
          },
        },
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects empty and multi-document legacy yaml sources', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const empty_file_path = join(temp_directory, 'empty.yaml');
  const multi_file_path = join(temp_directory, 'multi.yaml');

  try {
    await writeFile(empty_file_path, '', 'utf8');
    await writeFile(
      multi_file_path,
      ['jobs: {}', '---', 'jobs: {}', ''].join('\n'),
      'utf8',
    );

    await expect(
      loadLegacyStateMachineDefinition(empty_file_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: empty_file_path,
          message: 'Flow documents must contain exactly one YAML document.',
        },
      ],
      flow_definition: null,
    });
    await expect(
      loadLegacyStateMachineDefinition(multi_file_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: multi_file_path,
          message: 'Flow documents must contain exactly one YAML document.',
        },
      ],
      flow_definition: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects invalid legacy yaml syntax', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const invalid_yaml_path = join(temp_directory, 'invalid.yaml');

  try {
    await writeFile(invalid_yaml_path, ['jobs: [', ''].join('\n'), 'utf8');

    await expect(
      loadLegacyStateMachineDefinition(invalid_yaml_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: invalid_yaml_path,
          message: asMatcher(
            expect.stringContaining('Invalid YAML flow definition:'),
          ),
        },
      ],
      flow_definition: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects legacy yaml documents that do not evaluate to an object', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const array_yaml_path = join(temp_directory, 'array.yaml');

  try {
    await writeFile(array_yaml_path, ['- task', ''].join('\n'), 'utf8');

    await expect(
      loadLegacyStateMachineDefinition(array_yaml_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: array_yaml_path,
          message: 'Flow YAML must evaluate to an object.',
        },
      ],
      flow_definition: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects legacy yaml documents without top-level jobs', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const missing_jobs_path = join(temp_directory, 'missing-jobs.yaml');

  try {
    await writeFile(
      missing_jobs_path,
      ['workspace: {}', ''].join('\n'),
      'utf8',
    );

    await expect(
      loadLegacyStateMachineDefinition(missing_jobs_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: missing_jobs_path,
          message: 'Flow YAML must define a top-level "jobs" mapping.',
        },
      ],
      flow_definition: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('preserves multiple legacy yaml parser diagnostics', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-legacy-flow-'));
  const flow_file_path = join(temp_directory, 'flow.yaml');

  try {
    await writeFile(
      flow_file_path,
      [
        'jobs:',
        '  demo:',
        '    next:',
        '      - goto: [',
        '      - goto: [',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(
      loadLegacyStateMachineDefinition(flow_file_path),
    ).resolves.toEqual({
      diagnostics: [
        {
          file_path: flow_file_path,
          message: asMatcher(
            expect.stringContaining('Invalid YAML flow definition:'),
          ),
        },
        {
          file_path: flow_file_path,
          message: asMatcher(
            expect.stringContaining('Invalid YAML flow definition:'),
          ),
        },
      ],
      flow_definition: null,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
