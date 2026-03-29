/* eslint-disable max-lines-per-function */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { normalizePravahaConfig } from './load-pravaha-config.js';
import { loadPravahaConfig } from './load-pravaha-config.js';

it('applies default optional flow and plugin config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([]);
});

it('applies default queue config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([]);
});

it('accepts valid optional flow config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        flows: {
          default_matches: ['docs/flows/**/*.yaml', 'docs/flows/**/*.yml'],
          root_flow_label: 'Implementation flow',
        },
        plugins: {
          dir: 'custom-plugins',
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual({
    ...createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
    flow_config: {
      default_matches: ['docs/flows/**/*.yaml', 'docs/flows/**/*.yml'],
      root_flow_label: 'Implementation flow',
    },
    plugin_config: {
      dir: 'custom-plugins',
    },
  });
  expect(diagnostics).toEqual([]);
});

it('accepts valid optional queue config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        queue: {
          base_ref: 'refs/queue/meta/upstream',
          candidate_ref: 'refs/queue/candidate/release',
          dir: '.pravaha/custom-queue.git',
          ready_ref_prefix: 'refs/queue/ready-items',
          target_branch: 'release',
          upstream_remote: 'upstream',
          validation_flow: 'docs/flows/runtime/validate-queue.yaml',
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual({
    ...createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
    queue_config: {
      base_ref: 'refs/queue/meta/upstream',
      candidate_ref: 'refs/queue/candidate/release',
      dir: '.pravaha/custom-queue.git',
      ready_ref_prefix: 'refs/queue/ready-items',
      target_branch: 'release',
      upstream_remote: 'upstream',
      validation_flow: 'docs/flows/runtime/validate-queue.yaml',
    },
  });
  expect(diagnostics).toEqual([]);
});

it('reports invalid optional flow config shapes', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        flows: {
          default_matches: ['docs/flows/**/*.yaml', ''],
          root_flow_label: '  ',
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config flows.default_matches must be an array of non-empty strings when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config flows.root_flow_label must be a non-empty string when present.',
    },
  ]);
});

it('reports non-object flows and invalid plugin config', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        flows: [],
        plugins: {
          dir: '  ',
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message: 'Pravaha config flows must be an object when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config plugins.dir must be a non-empty string when present.',
    },
  ]);
});

it('reports invalid queue config shapes', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        queue: {
          base_ref: '',
          candidate_ref: '',
          dir: '',
          ready_ref_prefix: '',
          target_branch: '',
          upstream_remote: '',
          validation_flow: '',
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.dir must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.upstream_remote must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.target_branch must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.ready_ref_prefix must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.candidate_ref must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.base_ref must be a non-empty string when present.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config queue.validation_flow must be a non-empty string or null when present.',
    },
  ]);
});

it('reports non-object queue config and accepts null validation flow', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        queue: [],
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message: 'Pravaha config queue must be an object when present.',
    },
  ]);

  /** @type {Array<{ file_path: string, message: string }>} */
  const null_validation_flow_diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        queue: {
          validation_flow: null,
        },
        semantic_roles: {
          contract: ['contract'],
        },
        semantic_states: {
          ready: ['ready'],
        },
      },
      'pravaha.json',
      null_validation_flow_diagnostics,
    ),
  ).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: {
        contract: ['contract'],
      },
      semantic_states: {
        ready: ['ready'],
      },
    }),
  );
  expect(null_validation_flow_diagnostics).toEqual([]);
});

it('loads pravaha config from disk and preserves json diagnostics', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-config-'));
  const pravaha_config_path = join(temp_directory, 'pravaha.json');

  await writeFile(pravaha_config_path, '{\n');

  const load_result = await loadPravahaConfig(temp_directory);

  expect(load_result.config).toEqual(
    createExpectedPravahaConfig({
      semantic_roles: undefined,
      semantic_states: undefined,
    }),
  );
  expect(load_result.file_path).toBe(pravaha_config_path);
  expect(load_result.json_result.value).toBeNull();
  expect(load_result.diagnostics).toHaveLength(1);
  expect(load_result.diagnostics[0]).toMatchObject({
    file_path: pravaha_config_path,
  });
  expect(load_result.diagnostics[0].message).toContain(
    'Cannot load JSON file:',
  );
  expect(load_result.json_result.diagnostics).toHaveLength(1);
  expect(load_result.json_result.diagnostics[0]).toMatchObject({
    file_path: pravaha_config_path,
  });
  expect(load_result.json_result.diagnostics[0].message).toContain(
    'Cannot load JSON file:',
  );
});

/**
 * @param {{
 *   semantic_roles: Record<string, unknown> | undefined,
 *   semantic_states: Record<string, unknown> | undefined,
 * }} options
 * @returns {{
 *   flow_config: {
 *     default_matches: string[],
 *     root_flow_label: string,
 *   },
 *   plugin_config: {
 *     dir: string,
 *   },
 *   queue_config: {
 *     base_ref: string,
 *     candidate_ref: string,
 *     dir: string,
 *     ready_ref_prefix: string,
 *     target_branch: string,
 *     upstream_remote: string,
 *     validation_flow: string | null,
 *   },
 *   semantic_roles: Record<string, unknown> | undefined,
 *   semantic_states: Record<string, unknown> | undefined,
 * }}
 */
function createExpectedPravahaConfig(options) {
  return {
    flow_config: {
      default_matches: [],
      root_flow_label: 'Root flow',
    },
    plugin_config: {
      dir: 'plugins',
    },
    queue_config: {
      base_ref: 'refs/queue/meta/base',
      candidate_ref: 'refs/queue/candidate/current',
      dir: '.pravaha/queue.git',
      ready_ref_prefix: 'refs/queue/ready',
      target_branch: 'main',
      upstream_remote: 'origin',
      validation_flow: null,
    },
    semantic_roles: options.semantic_roles,
    semantic_states: options.semantic_states,
  };
}
