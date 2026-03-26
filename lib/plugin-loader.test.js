/* eslint-disable max-lines-per-function */
import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginPackageSource,
} from './plugin.fixture-test-helpers.js';
import {
  collectFlowStepPlugins,
  DEFAULT_LOCAL_PLUGIN_DIRECTORY,
  loadStepPlugin,
  readLocalPluginDirectory,
} from './plugin-loader.js';

it('loads a local plugin from the default repo-local plugin directory', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/emit-ready.js': createPluginModuleSource({
        emits_source: '{ review_requested: z.object({ status: z.string() }) }',
      }),
    },
  });

  try {
    const plugin_result = await loadStepPlugin(
      temp_directory,
      'local/emit-ready',
    );

    expect(plugin_result.resolution.kind).toBe('local');
    expect(plugin_result.resolution.uses_value).toBe('local/emit-ready');
    expect(Object.keys(plugin_result.plugin.emits)).toEqual([
      'review_requested',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads a local plugin from the configured repo-local plugin directory', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'custom-plugins/prepare-worktree.js': createPluginModuleSource({
        emits_source: '{ setup_completed: z.object({ ok: z.boolean() }) }',
      }),
    },
    pravaha_config_text: [
      '{',
      '  "semantic_roles": {',
      '    "contract": ["contract"],',
      '    "decision": ["decision"],',
      '    "flow": ["flow"],',
      '    "task": ["task"]',
      '  },',
      '  "semantic_states": {',
      '    "active": ["active"],',
      '    "blocked": ["blocked"],',
      '    "proposed": ["proposed"],',
      '    "ready": ["ready"],',
      '    "review": ["review"],',
      '    "terminal": ["accepted", "done", "dropped", "superseded"]',
      '  },',
      '  "plugins": {',
      '    "local_directory": "custom-plugins"',
      '  }',
      '}',
      '',
    ].join('\n'),
  });

  try {
    const plugin_result = await loadStepPlugin(
      temp_directory,
      'local/prepare-worktree',
    );

    expect(plugin_result.resolution.kind).toBe('local');
    expect(plugin_result.resolution.local_directory).toBe('custom-plugins');
    expect(Object.keys(plugin_result.plugin.emits)).toEqual([
      'setup_completed',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads an npm plugin from the installed package entrypoint', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginPackageSource({
      package_name: 'pravaha-plugin-review',
      package_source: createPluginModuleSource({
        emits_source:
          '{ review_requested: z.object({ reviewer: z.string() }) }',
      }),
    }),
  });

  try {
    const plugin_result = await loadStepPlugin(
      temp_directory,
      'npm/pravaha-plugin-review',
    );

    expect(plugin_result.resolution.kind).toBe('npm');
    expect(plugin_result.resolution.package_name).toBe('pravaha-plugin-review');
    expect(Object.keys(plugin_result.plugin.emits)).toEqual([
      'review_requested',
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a plugin module without a default definePlugin export', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/bad-export.js': 'export const nope = 1;\n',
    },
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/bad-export'),
    ).rejects.toThrow('must default-export definePlugin(...)');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads built-in core plugins and collects unique flow step plugins', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/review-ready.js': createPluginModuleSource({
        emits_source:
          '{ review_requested: z.object({ reviewer: z.string() }) }',
      }),
    },
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'core/codex-sdk'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'core',
        uses_value: 'core/codex-sdk',
      },
    });
    await expect(
      collectFlowStepPlugins(temp_directory, {
        jobs: {
          demo: {
            steps: [
              {
                uses: 'core/codex-sdk',
              },
              {
                uses: 'local/review-ready',
              },
              {
                uses: 'local/review-ready',
              },
              'skip',
            ],
          },
          skipped: {
            steps: /** @type {never} */ ('invalid'),
          },
        },
      }),
    ).resolves.toMatchObject({
      emitted_signal_schemas: new Map([
        ['worker_completed', expect.anything()],
        ['review_requested', expect.anything()],
      ]),
      step_plugins: new Map([
        ['core/codex-sdk', expect.anything()],
        ['local/review-ready', expect.anything()],
      ]),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects invalid plugin references and invalid local plugin config', async () => {
  const temp_directory = await createPluginFixtureRepo({
    pravaha_config_text: '{}\n',
  });
  const invalid_config_directory = await createPluginFixtureRepo({
    pravaha_config_text: '{"plugins":{"local_directory":"  "}}\n',
  });

  try {
    await expect(readLocalPluginDirectory(temp_directory)).resolves.toBe(
      DEFAULT_LOCAL_PLUGIN_DIRECTORY,
    );
    await expect(
      readLocalPluginDirectory(invalid_config_directory),
    ).rejects.toThrow(
      'Pravaha config plugins.local_directory must be a non-empty string when present.',
    );
    await expect(loadStepPlugin(temp_directory, 'local/')).rejects.toThrow(
      'Expected local plugin references to include a plugin name.',
    );
    await expect(loadStepPlugin(temp_directory, 'npm/  ')).rejects.toThrow(
      'Expected npm plugin references to include a package name.',
    );
    await expect(
      loadStepPlugin(temp_directory, 'custom/review-ready'),
    ).rejects.toThrow('Unsupported uses step "custom/review-ready".');
    await expect(
      loadStepPlugin(temp_directory, 'local/missing-plugin'),
    ).rejects.toThrow('Cannot resolve plugin "local/missing-plugin".');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
    await rm(invalid_config_directory, { force: true, recursive: true });
  }
});

it('loads local plugins from an index module path', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/review/index.js': createPluginModuleSource({
        emits_source:
          '{ review_requested: z.object({ reviewer: z.string() }) }',
      }),
    },
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/review'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'local',
        module_path: expect.stringContaining('/plugins/review/index.js'),
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns the default local plugin directory when pravaha.json is not an object', async () => {
  const temp_directory = await createPluginFixtureRepo({
    pravaha_config_text: '[]\n',
  });

  try {
    await expect(readLocalPluginDirectory(temp_directory)).resolves.toBe(
      DEFAULT_LOCAL_PLUGIN_DIRECTORY,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads the core request-review plugin and ignores non-step flow shapes', async () => {
  const temp_directory = await createPluginFixtureRepo();

  try {
    await expect(
      loadStepPlugin(temp_directory, 'core/request-review'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'core',
        uses_value: 'core/request-review',
      },
    });
    await expect(
      collectFlowStepPlugins(temp_directory, {
        jobs: {
          broken: {
            steps: null,
          },
        },
      }),
    ).resolves.toEqual({
      emitted_signal_schemas: new Map(),
      step_plugins: new Map(),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
