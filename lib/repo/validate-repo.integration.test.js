import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import patram_config from '../../.patram.json' with { type: 'json' };
import pravaha_config from '../../pravaha.json' with { type: 'json' };
import { linkPravahaPackage } from '../../test/fixtures/runtime-fixture.js';
import { validateRepo } from './validate-repo.js';

it('validates JavaScript flow trigger classes against the repo config', async () => {
  const temp_directory = await createFixtureRepo({
    flow_source: createFlowModuleSource({
      query_text: '$class == task and status == ready',
    }),
  });

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('reports unknown Patram classes in JavaScript flow trigger queries', async () => {
  const temp_directory = await createFixtureRepo({
    flow_source: createFlowModuleSource({
      query_text: '$class == worker and status == ready',
    }),
  });

  try {
    await linkPravahaPackage(temp_directory);

    const validation_result = await validateRepo(temp_directory);
    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.js',
    );

    expect(validation_result.checked_flow_count).toBe(1);
    expect(validation_result.diagnostics).toEqual([
      {
        file_path: flow_file_path,
        message:
          'Unknown Patram class "worker" in trigger query. in flow.on.patram.',
      },
    ]);
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('does not validate optional flow config in pravaha.json during repo validation', async () => {
  const temp_directory = await createFixtureRepo({
    pravaha_config_override: {
      ...pravaha_config,
      flows: {
        default_matches: ['docs/flows/**/*.yaml', ''],
      },
    },
  });

  try {
    await linkPravahaPackage(temp_directory);

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('ignores checked-in yaml flow files during repo validation', async () => {
  const temp_directory = await createFixtureRepo({
    flow_path: 'docs/flows/runtime/test-flow.yaml',
    flow_source: ['jobs: {}', ''].join('\n'),
  });

  try {
    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 0,
      diagnostics: [],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects JavaScript flow modules with legacy graph fields', async () => {
  const temp_directory = await createFixtureRepo({
    flow_source: createFlowModuleSource({
      extra_lines: ['  jobs: {},'],
    }),
  });

  try {
    await linkPravahaPackage(temp_directory);

    const flow_file_path = join(
      temp_directory,
      'docs/flows/runtime/test-flow.js',
    );

    await expect(validateRepo(temp_directory)).resolves.toEqual({
      checked_flow_count: 1,
      diagnostics: [
        {
          file_path: flow_file_path,
          message:
            'Legacy field flow.jobs is no longer supported in JavaScript flow modules.',
        },
      ],
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   flow_path?: string,
 *   flow_source?: string,
 *   pravaha_config_override?: Record<string, unknown>,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createFixtureRepo(options = {}) {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-validation-'));
  const flow_file_path = join(
    temp_directory,
    options.flow_path ?? 'docs/flows/runtime/test-flow.js',
  );
  const patram_config_path = join(temp_directory, '.patram.json');
  const pravaha_config_path = join(temp_directory, 'pravaha.json');
  const flow_source = options.flow_source ?? createFlowModuleSource();
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
  await writeFile(flow_file_path, flow_source.trimEnd().concat('\n'));

  return temp_directory;
}

/**
 * @param {{
 *   extra_lines?: string[],
 *   query_text?: string,
 * }} [options]
 * @returns {string}
 */
function createFlowModuleSource(options = {}) {
  return [
    "import { defineFlow } from 'pravaha';",
    '',
    'export default defineFlow({',
    '  on: {',
    `    patram: '${options.query_text ?? '$class == task and status == ready'}',`,
    '  },',
    '  workspace: {',
    "    id: 'app',",
    '  },',
    '  async main(ctx) {',
    '    void ctx;',
    '  },',
    ...(options.extra_lines ?? []),
    '});',
    '',
  ].join('\n');
}
