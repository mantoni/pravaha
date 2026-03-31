// @module-tag lint-staged-excluded

import { rm } from 'node:fs/promises';

import { expect, it } from 'vitest';

import {
  createReconcilerFixtureRepo,
  FLOW_PATH,
} from '../../test/fixtures/reconcile-fixture.js';
import { createFixtureRepoFromFiles } from '../../test/fixtures/runtime-fixture.js';
import { loadExecutableDispatchFlow } from './load-executable-dispatch-flow.js';

it('loads the checked-in dispatch flow through the executable wrapper', async () => {
  const temp_directory = await createReconcilerFixtureRepo();

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).resolves.toMatchObject({
      flow: {
        handlers: {
          main: asMatcher(expect.any(Function)),
        },
        trigger: {
          owner_class: 'task',
        },
        workspace: 'app',
      },
      surface: 'javascript-module',
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects malformed trigger queries', async () => {
  const temp_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      on_lines: [
        '  on: {',
        "    review: '$class == task and status == ready',",
        '  },',
      ],
    }),
  );

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define flow.on.patram as a string.`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects non-object trigger definitions', async () => {
  const temp_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      on_lines: ["  on: 'nope',"],
    }),
  );

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} to define flow.on.patram as a string.`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects non-string workspace definitions during flow interpretation', async () => {
  const temp_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      workspace_lines: ['  workspace: { id: "app" },'],
    }),
  );

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace to be a non-empty string.`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects missing workspace strings and blank workspace ids', async () => {
  const missing_workspace_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      workspace_lines: ['  workspace: null,'],
    }),
  );
  const blank_workspace_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      workspace_lines: ["  workspace: '  ',"],
    }),
  );

  try {
    await expect(
      loadExecutableDispatchFlow(missing_workspace_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace to be a non-empty string.`,
    );
    await expect(
      loadExecutableDispatchFlow(blank_workspace_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Expected ${FLOW_PATH} workspace to be a non-empty string.`,
    );
  } finally {
    await rm(missing_workspace_directory, { force: true, recursive: true });
    await rm(blank_workspace_directory, { force: true, recursive: true });
  }
});

it('rejects legacy graph fields during flow interpretation', async () => {
  const temp_directory = await createJavaScriptFlowRepo(
    createFlowModuleSource({
      extra_lines: ['  jobs: {},'],
    }),
  );

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      'Legacy field flow.jobs is no longer supported in JavaScript flow modules.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('formats loader diagnostics when the flow module cannot be imported', async () => {
  const temp_directory = await createFixtureRepoFromFiles(
    'pravaha-reconcile-js-',
    {
      [FLOW_PATH]: 'export default {};\n',
    },
  );

  try {
    await expect(
      loadExecutableDispatchFlow(temp_directory, FLOW_PATH),
    ).rejects.toThrow(
      `Cannot load JavaScript flow module: Flow module "${FLOW_PATH}" must default-export defineFlow(...).`,
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {string} flow_module_source
 * @returns {Promise<string>}
 */
async function createJavaScriptFlowRepo(flow_module_source) {
  return createReconcilerFixtureRepo({
    flow_module_source,
  });
}

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}

/**
 * @param {{
 *   extra_lines?: string[],
 *   import_names?: string[],
 *   main_lines?: string[],
 *   on_lines?: string[],
 *   workspace_lines?: string[],
 * }} [options]
 * @returns {string}
 */
function createFlowModuleSource(options = {}) {
  return [
    `import { ${(options.import_names ?? ['defineFlow']).join(', ')} } from 'pravaha/flow';`,
    '',
    'export default defineFlow({',
    ...(options.on_lines ?? [
      '  on: {',
      "    patram: '$class == task and tracked_in == contract:single-task-flow-reconciler and status == ready',",
      '  },',
    ]),
    ...(options.workspace_lines ?? ["  workspace: 'app',"]),
    ...(options.main_lines ?? ['  async main(ctx) {', '    void ctx;', '  },']),
    ...(options.extra_lines ?? []),
    '});',
    '',
  ].join('\n');
}
