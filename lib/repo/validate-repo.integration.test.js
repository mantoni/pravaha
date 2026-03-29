import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import patram_config from '../../.patram.json' with { type: 'json' };
import pravaha_config from '../../pravaha.json' with { type: 'json' };

import { validateRepo } from './validate-repo.js';

it('validates flow semantic references against the repo config', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: [
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    id: app',
      '  materialize:',
      '    kind: worktree',
      '    mode: ephemeral',
      '    ref: main',
      'on:',
      '  task:',
      '    where: $class == task and tracked_in == @document',
      'jobs:',
      '  review-task:',
      '    uses: core/approval',
      '    with:',
      '      title: Review',
      '      message: Approve the task.',
      '      options: [approve, reject]',
      '    next:',
      '      - if: ${{ result.verdict == "approve" }}',
      '        goto: done',
      '      - goto: rejected',
      '  done:',
      '    end: success',
      '  rejected:',
      '    end: rejected',
      '',
    ].join('\n'),
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports unknown semantic roles and states in flow documents', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: [
      'workspace:',
      '  type: git.workspace',
      '  source:',
      '    kind: repo',
      '    id: app',
      '  materialize:',
      '    kind: worktree',
      '    mode: ephemeral',
      '    ref: main',
      'on:',
      '  lease:',
      '    where: $class == worker and tracked_in == @document and status == ready',
      'jobs:',
      '  lease-task:',
      '    uses: core/run',
      '    with:',
      '      command: npm test',
      '    next: done',
      '  done:',
      '    end: success',
      '',
    ].join('\n'),
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.yaml',
    );

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toEqual([
      {
        file_path: flow_file_path,
        message:
          'Unknown semantic role "worker" in select query. in flow.on.lease.where.',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports invalid semantic-state mappings in pravaha.json', async () => {
  const temp_directory = await createFixtureRepo({
    pravaha_config_override: {
      semantic_roles: pravaha_config.semantic_roles,
      semantic_states: {
        review: ['review'],
        terminal: ['not-a-status'],
      },
    },
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const pravaha_config_path = join(temp_directory, 'pravaha.json');

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toEqual([
      {
        file_path: pravaha_config_path,
        message:
          'semantic state "terminal" references unknown target "not-a-status".',
      },
      {
        file_path: pravaha_config_path,
        message: 'Missing required semantic state "ready".',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('accepts optional flow config in pravaha.json', async () => {
  const temp_directory = await createFixtureRepo({
    pravaha_config_override: {
      ...pravaha_config,
      flows: {
        default_matches: ['docs/flows/**/*.yaml'],
        root_flow_label: 'Implementation flow',
      },
    },
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports invalid optional flow config in pravaha.json', async () => {
  const temp_directory = await createFixtureRepo({
    pravaha_config_override: {
      ...pravaha_config,
      flows: {
        default_matches: ['docs/flows/**/*.yaml', ''],
        root_flow_label: '',
      },
    },
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const pravaha_config_path = join(temp_directory, 'pravaha.json');

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toContainEqual({
      file_path: pravaha_config_path,
      message:
        'Pravaha config flows.default_matches must be an array of non-empty strings when present.',
    });
    expect(validation_result.diagnostics).toContainEqual({
      file_path: pravaha_config_path,
      message:
        'Pravaha config flows.root_flow_label must be a non-empty string when present.',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('validates state-machine flow documents against the repo config', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: createValidStateMachineFlowYaml(),
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('accepts state-machine flows that still define jobs.<name>.select', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: createValidStateMachineFlowYaml().replace(
      '    next: done',
      '    select: role\n    next: done',
    ),
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects legacy step-based flow fields after the breaking migration', async () => {
  const temp_directory = await createFixtureRepo({
    flow_yaml: createMixedFlowYaml(),
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.yaml',
    );

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toContainEqual({
      file_path: flow_file_path,
      message:
        'Expected flow.jobs.legacy_review to define a supported state-machine job.',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects invalid state-machine workspace diagnostics', async () => {
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace(
      'type: git.workspace',
      'type: shell.workspace',
    ),
    'Expected flow.workspace.type to be "git.workspace".',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace('kind: repo', 'kind: remote'),
    'Expected flow.workspace.source.kind to be "repo".',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace(
      'mode: ephemeral',
      'mode: shared',
    ),
    'Expected flow.workspace.materialize.mode to be "ephemeral" or "pooled".',
  );
});

it('rejects invalid state-machine job diagnostics', async () => {
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace('next: done', 'next: missing'),
    'Unknown next target "missing" at flow.jobs.retry.next.',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace('max-visits: 3', 'max-visits: 0'),
    'Expected flow.jobs.retry.limits.max-visits to be a positive integer.',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace('end: success', 'end: ""'),
    'Expected flow.jobs.done.end to be a non-empty string.',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace(
      '      - if: ${{ result.exit_code == 0 }}\n        goto: done',
      '      - goto: done\n      - if: ${{ result.exit_code == 0 }}\n        goto: retry',
    ),
    'Only the final flow.jobs.implement.next branch may omit if.',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace(
      'on:\n  task:\n    where: $class == task and tracked_in == @document',
      'on:\n  document:\n    where: $class == task and tracked_in == @document',
    ),
    'Reserved trigger binding name "document" is not allowed at flow.on.document.',
  );
  await expectValidationDiagnostic(
    createValidStateMachineFlowYaml().replace(
      'on:\n  task:\n    where: $class == task and tracked_in == @document',
      'on:\n  task: {}',
    ),
    'Expected flow.on.task.where to be a string.',
  );
});

/**
 * @param {{
 *   flow_yaml?: string,
 *   pravaha_config_override?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createFixtureRepo(options = {}) {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-validation-'));
  const flow_file_path = join(
    temp_directory,
    'docs/flows/runtime/test-flow.yaml',
  );
  const patram_config_path = join(temp_directory, '.patram.json');
  const pravaha_config_path = join(temp_directory, 'pravaha.json');
  const flow_yaml = options.flow_yaml ?? createDefaultFlowYaml();
  const effective_pravaha_config =
    options.pravaha_config_override ?? pravaha_config;

  await mkdir(dirname(flow_file_path), { recursive: true });
  await writeFile(
    patram_config_path,
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );
  await writeFile(
    pravaha_config_path,
    `${JSON.stringify(effective_pravaha_config, null, 2)}\n`,
  );
  await writeFile(flow_file_path, createFlowDocument(flow_yaml));

  return temp_directory;
}

/**
 * @param {string} flow_yaml
 * @returns {string}
 */
function createFlowDocument(flow_yaml) {
  return flow_yaml.trimEnd().concat('\n');
}

/**
 * @returns {string}
 */
function createDefaultFlowYaml() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document',
    'jobs:',
    '  smoke:',
    '    uses: core/run',
    '    with:',
    '      command: npm run all',
    '    next: done',
    '  done:',
    '    end: success',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createValidStateMachineFlowYaml() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document',
    'jobs:',
    '  implement:',
    '    uses: core/run-codex',
    '    with:',
    '      prompt: Implement the task.',
    '      reasoning: medium',
    '    next:',
    '      - if: ${{ result.exit_code == 0 }}',
    '        goto: done',
    '      - goto: retry',
    '  retry:',
    '    uses: core/run',
    '    with:',
    '      command: npm test',
    '    limits:',
    '      max-visits: 3',
    '    next: done',
    '  done:',
    '    end: success',
    '',
  ].join('\n');
}

/**
 * @returns {string}
 */
function createMixedFlowYaml() {
  return [
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: pooled',
    '    ref: main',
    'on:',
    '  task:',
    '    where: $class == task and tracked_in == @document',
    'jobs:',
    '  implement:',
    '    uses: core/run-codex',
    '    next: done',
    '  legacy_review:',
    '    steps:',
    '      - transition:',
    '          target: task',
    '          status: review',
    '  done:',
    '    end: success',
    '',
  ].join('\n');
}

/**
 * @param {string} flow_yaml
 * @param {string} expected_message
 * @returns {Promise<void>}
 */
async function expectValidationDiagnostic(flow_yaml, expected_message) {
  const temp_directory = await createFixtureRepo({
    flow_yaml,
  });

  try {
    const validation_result = await validateRepo(temp_directory);
    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.yaml',
    );

    expect(validation_result.diagnostics).toContainEqual({
      file_path: flow_file_path,
      message: expected_message,
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}
