import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createPluginFixtureRepo,
  createPluginModuleSource,
  createPluginPackageSource,
} from './plugin.fixture-test-helpers.js';
import { loadStepPlugin } from './plugin-loader.js';

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
