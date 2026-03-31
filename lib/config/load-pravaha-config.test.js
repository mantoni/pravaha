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

  expect(normalizePravahaConfig({}, 'pravaha.json', diagnostics)).toEqual(
    createExpectedPravahaConfig(),
  );
  expect(diagnostics).toEqual([]);
});

it('applies default queue config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(normalizePravahaConfig({}, 'pravaha.json', diagnostics)).toEqual(
    createExpectedPravahaConfig(),
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
          default_matches: ['docs/flows/**/*.js', 'docs/flows/**/*.mjs'],
        },
        plugins: {
          dir: 'custom-plugins',
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual({
    ...createExpectedPravahaConfig(),
    flow_config: {
      default_matches: ['docs/flows/**/*.js', 'docs/flows/**/*.mjs'],
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
          validation_flow: 'docs/flows/runtime/validate-queue.js',
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual({
    ...createExpectedPravahaConfig(),
    queue_config: {
      base_ref: 'refs/queue/meta/upstream',
      candidate_ref: 'refs/queue/candidate/release',
      dir: '.pravaha/custom-queue.git',
      ready_ref_prefix: 'refs/queue/ready-items',
      target_branch: 'release',
      upstream_remote: 'upstream',
      validation_flow: 'docs/flows/runtime/validate-queue.js',
    },
  });
  expect(diagnostics).toEqual([]);
});

it('accepts valid workspace config values', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        workspaces: {
          app: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/app', '/tmp/pravaha/app-1'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          validation: {
            base_path: '.pravaha/worktrees/validation',
            mode: 'ephemeral',
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual({
    ...createExpectedPravahaConfig(),
    workspace_config: {
      app: {
        mode: 'pooled',
        paths: ['.pravaha/worktrees/app', '/tmp/pravaha/app-1'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
      validation: {
        base_path: '.pravaha/worktrees/validation',
        mode: 'ephemeral',
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
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
          default_matches: ['docs/flows/**/*.js', ''],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config flows.default_matches must be an array of non-empty .js or .mjs paths/globs when present.',
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
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
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
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
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
        'Pravaha config queue.validation_flow must be a non-empty .js or .mjs path when present.',
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
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
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
      },
      'pravaha.json',
      null_validation_flow_diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
  expect(null_validation_flow_diagnostics).toEqual([]);
});

it('reports invalid workspace config shapes', () => {
  /** @type {Array<{ file_path: string, message: string }>} */
  const diagnostics = [];

  expect(
    normalizePravahaConfig(
      {
        workspaces: {
          app: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/app', ''],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          missing_mode: {
            paths: ['.pravaha/worktrees/missing-mode'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          ephemeral_missing_base: {
            mode: 'ephemeral',
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          pooled_with_base: {
            base_path: '.pravaha/worktrees/mixed',
            mode: 'pooled',
            paths: ['.pravaha/worktrees/mixed-a'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          ephemeral_with_paths: {
            mode: 'ephemeral',
            paths: ['.pravaha/worktrees/ephemeral'],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          bad_source_kind: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/source-kind'],
            ref: 'main',
            source: {
              kind: 'remote',
            },
          },
          missing_ref: {
            mode: 'pooled',
            paths: ['.pravaha/worktrees/missing-ref'],
            ref: '',
            source: {
              kind: 'repo',
            },
          },
          empty_paths: {
            mode: 'pooled',
            paths: [],
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
          broken: [],
        },
      },
      'pravaha.json',
      diagnostics,
    ),
  ).toEqual(createExpectedPravahaConfig());
  expect(diagnostics).toEqual([
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.app.paths must be an array of unique non-empty strings.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.missing_mode.mode must be "pooled" or "ephemeral".',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.ephemeral_missing_base.base_path must be a non-empty string.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.pooled_with_base must not define base_path for pooled mode.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.ephemeral_with_paths must not define paths for ephemeral mode.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.bad_source_kind.source.kind must be "repo".',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.missing_ref.ref must be a non-empty string.',
    },
    {
      file_path: 'pravaha.json',
      message:
        'Pravaha config workspaces.empty_paths.paths must be an array of unique non-empty strings.',
    },
    {
      file_path: 'pravaha.json',
      message: 'Pravaha config workspaces.broken must be an object.',
    },
  ]);
});

it('loads pravaha config from disk and preserves json diagnostics', async () => {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-config-'));
  const pravaha_config_path = join(temp_directory, 'pravaha.json');

  await writeFile(pravaha_config_path, '{\n');

  const load_result = await loadPravahaConfig(temp_directory);

  expect(load_result.config).toEqual(createExpectedPravahaConfig());
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
 * @returns {{
 *   flow_config: {
 *     default_matches: string[],
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
 *   workspace_config: Record<
 *     string,
 *     | {
 *         mode: 'pooled',
 *         paths: string[],
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *     | {
 *         base_path: string,
 *         mode: 'ephemeral',
 *         ref: string,
 *         source: {
 *           kind: 'repo',
 *         },
 *       }
 *   >,
 * }}
 */
function createExpectedPravahaConfig() {
  return {
    flow_config: {
      default_matches: [],
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
    workspace_config: {},
  };
}
