/* eslint-disable max-lines-per-function */
import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginPackageSource,
} from '../../test/fixtures/plugin-fixture.js';
import { collectFlowStepPlugins, loadStepPlugin } from './plugin-loader.js';

it('loads a local plugin from the default repo-local plugin directory', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/emit-ready.js': createPluginModuleSource({}),
    },
  });

  try {
    const plugin_result = await loadStepPlugin(
      temp_directory,
      'local/emit-ready',
    );

    expect(plugin_result.resolution.kind).toBe('local');
    expect(plugin_result.resolution.uses_value).toBe('local/emit-ready');
    expect(plugin_result.plugin.with).toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads a local plugin from the configured repo-local plugin directory', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'custom-plugins/prepare-worktree.js': createPluginModuleSource({}),
    },
    pravaha_config_text: [
      '{',
      '  "plugins": {',
      '    "dir": "custom-plugins"',
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
    expect(plugin_result.resolution.dir).toBe('custom-plugins');
    expect(plugin_result.plugin.with).toBeUndefined();
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads an npm plugin from the installed package entrypoint', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: createPluginPackageSource({
      package_name: 'pravaha-plugin-review',
      package_source: createPluginModuleSource({}),
    }),
  });

  try {
    const plugin_result = await loadStepPlugin(
      temp_directory,
      'npm/pravaha-plugin-review',
    );

    expect(plugin_result.resolution.kind).toBe('npm');
    expect(plugin_result.resolution.package_name).toBe('pravaha-plugin-review');
    expect(plugin_result.plugin.with).toBeUndefined();
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

it('loads bundled core plugins and collects unique flow plugins across state-machine jobs', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/review-ready.js': createPluginModuleSource({}),
    },
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'core/run-codex'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'core',
        uses_value: 'core/run-codex',
      },
    });
    await expect(
      collectFlowStepPlugins(temp_directory, {
        jobs: {
          implement: {
            uses: 'core/run-codex',
            with: {
              prompt: 'Implement the task',
              reasoning: 'medium',
            },
            next: 'done',
          },
          review: {
            uses: 'local/review-ready',
            next: 'done',
          },
          skipped: {
            with: {
              nope: true,
            },
          },
        },
      }),
    ).resolves.toSatisfy(
      /**
       * @param {{ step_plugins: Map<string, unknown> }} plugin_collection
       * @returns {boolean}
       */
      (plugin_collection) => {
        expect(Array.from(plugin_collection.step_plugins.keys())).toEqual([
          'core/run-codex',
          'local/review-ready',
        ]);

        return true;
      },
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects invalid plugin references and invalid local plugin config', async () => {
  const temp_directory = await createPluginFixtureRepo({
    pravaha_config_text: '{}\n',
  });
  const invalid_config_directory = await createPluginFixtureRepo({
    pravaha_config_text: '{"plugins":{"dir":"  "}}\n',
  });

  try {
    await expect(
      loadStepPlugin(invalid_config_directory, 'local/missing-plugin'),
    ).rejects.toThrow(
      'Pravaha config plugins.dir must be a non-empty string when present.',
    );
    await expect(loadStepPlugin(temp_directory, 'local/')).rejects.toThrow(
      'Expected local plugin references to include a plugin name.',
    );
    await expect(loadStepPlugin(temp_directory, 'npm/  ')).rejects.toThrow(
      'Expected npm plugin references to include a package name.',
    );
    await expect(
      loadStepPlugin(temp_directory, 'core/lease-task'),
    ).rejects.toThrow('Unsupported uses step "core/lease-task".');
    await expect(
      loadStepPlugin(temp_directory, 'core/setup-worktree'),
    ).rejects.toThrow('Unsupported uses step "core/setup-worktree".');
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
      'plugins/review/index.js': createPluginModuleSource({}),
    },
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/review'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'local',
        module_path: asMatcher(
          expect.stringContaining('/plugins/review/index.js'),
        ),
      },
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

it('returns the default local plugin directory when pravaha.json is not an object', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/review-ready.js': createPluginModuleSource({}),
    },
    pravaha_config_text: '[]\n',
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/review-ready'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'local',
        dir: 'plugins',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('returns the default local plugin directory when plugins.dir is omitted', async () => {
  const temp_directory = await createPluginFixtureRepo({
    fixture_files: {
      'plugins/review-ready.js': createPluginModuleSource({}),
    },
    pravaha_config_text: '{"plugins":{}}\n',
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/review-ready'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'local',
        dir: 'plugins',
      },
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads supported core plugins and ignores flows without a jobs object', async () => {
  const temp_directory = await createPluginFixtureRepo();

  try {
    const approval_plugin = await loadStepPlugin(
      temp_directory,
      'core/approval',
    );

    expect(approval_plugin.resolution).toEqual({
      kind: 'core',
      uses_value: 'core/approval',
    });
    await expect(
      collectFlowStepPlugins(temp_directory, {
        jobs: null,
      }),
    ).resolves.toEqual({
      step_plugins: new Map(),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('loads the core approval plugin and ignores non-step flow shapes', async () => {
  const temp_directory = await createPluginFixtureRepo();

  try {
    await expect(
      loadStepPlugin(temp_directory, 'core/approval'),
    ).resolves.toMatchObject({
      resolution: {
        kind: 'core',
        uses_value: 'core/approval',
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
      step_plugins: new Map(),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('surfaces malformed pravaha config diagnostics while reading local plugins', async () => {
  const temp_directory = await createPluginFixtureRepo({
    pravaha_config_text: '{\n',
  });

  try {
    await expect(
      loadStepPlugin(temp_directory, 'local/missing-plugin'),
    ).rejects.toThrow('Cannot load JSON file:');
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});
