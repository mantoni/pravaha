/* eslint-disable max-lines-per-function */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { resolveGraphApi } from '../../shared/graph/resolve-graph-api.js';
import { createAdHocDispatchAssignment } from './ad-hoc-dispatch.js';
import { createRuntimeRecord } from '../records/runtime-record-model.js';
import {
  createFixtureDocument,
  createFixtureRepoFromFiles,
  linkPravahaPackage,
} from '../../../test/fixtures/runtime-fixture.js';

const CONTRACT_PATH = 'docs/contracts/runtime/ad-hoc.md';
const DECISION_PATH = 'docs/decisions/runtime/ad-hoc.md';
const FILE_FLOW_PATH = 'docs/flows/runtime/file-flow.js';
const PROMPT_FLOW_PATH = 'docs/flows/runtime/prompt-flow.js';
const PLAN_PATH = 'docs/plans/repo/v0.1/ad-hoc.md';
const TASK_PATH = 'docs/tasks/runtime/ad-hoc-input.md';

it('builds an ad hoc file assignment from a single matching flow', async () => {
  const repo_directory = await createAdHocDispatchRepo();

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: TASK_PATH,
        graph_api: resolveGraphApi(undefined),
        now: () => new Date('2026-03-31T09:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      binding_targets: {
        doc: {
          id: 'task:ad-hoc-input',
          path: TASK_PATH,
          status: 'ready',
        },
      },
      contract_path: CONTRACT_PATH,
      flow_path: FILE_FLOW_PATH,
      task_path: TASK_PATH,
      type: 'assignment',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects ad hoc prompt dispatch when more than one flow is eligible', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    second_prompt_flow: true,
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        graph_api: resolveGraphApi(undefined),
        now: () => new Date('2026-03-31T09:00:00.000Z'),
        prompt_text: 'Oh, hi!',
      }),
    ).rejects.toThrow(
      'Multiple prompt-dispatch flows match the supplied input; refusing to dispatch.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects ad hoc dispatch when both file and prompt input are provided', async () => {
  const repo_directory = await createAdHocDispatchRepo();

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: TASK_PATH,
        graph_api: resolveGraphApi(undefined),
        prompt_text: 'Oh, hi!',
      }),
    ).rejects.toThrow('Expected exactly one ad hoc dispatch input.');
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('builds a prompt-backed ad hoc assignment with explicit flow input', async () => {
  const repo_directory = await createAdHocDispatchRepo();

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        graph_api: resolveGraphApi(undefined),
        now: () => new Date('2026-03-31T09:00:00.000Z'),
        prompt_text: 'Oh, hi!',
      }),
    ).resolves.toMatchObject({
      flow_path: PROMPT_FLOW_PATH,
      input: {
        kind: 'prompt',
        prompt: 'Oh, hi!',
      },
      type: 'assignment',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('writes prompt input into a durable repo file for ad hoc prompt runs', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    existing_flow_instance_id: 'aaa',
  });

  try {
    const assignment = await createAdHocDispatchAssignment(repo_directory, {
      graph_api: resolveGraphApi(undefined),
      now: () => new Date('2026-03-31T09:00:00.000Z'),
      prompt_text: 'Oh, hi!',
    });

    if (typeof assignment.task_path !== 'string') {
      throw new Error('Expected prompt dispatch to create a task path.');
    }

    const prompt_input_path = join(repo_directory, assignment.task_path);

    expect(assignment.flow_instance_id).not.toBe('aaa');
    await expect(readFile(prompt_input_path, 'utf8')).resolves.toBe(
      'Oh, hi!\n',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('warns when a file-selected flow also has on.patram and the file does not match', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    task_status: 'blocked',
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: TASK_PATH,
        graph_api: resolveGraphApi(undefined),
        now: () => new Date('2026-03-31T09:00:00.000Z'),
      }),
    ).rejects.toThrow(
      `Flow ${FILE_FLOW_PATH} matched ${TASK_PATH} through flow.on.file but the file does not satisfy flow.on.patram.`,
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects file dispatch when no flow.on.file pattern matches the supplied file', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    extra_files: {
      'notes/input.md': '# Notes\n',
    },
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: 'notes/input.md',
        graph_api: resolveGraphApi(undefined),
      }),
    ).rejects.toThrow(
      'No file-dispatch flow matches notes/input.md; refusing to dispatch.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects file dispatch when the supplied path resolves outside the repository', async () => {
  const repo_directory = await createAdHocDispatchRepo();

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: '../outside.md',
        graph_api: resolveGraphApi(undefined),
      }),
    ).rejects.toThrow(
      'Expected ../outside.md to resolve inside the repository.',
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('binds non-patram files synthetically and falls back to the flow path as contract context', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    extra_files: {
      'notes/input.md': '# Notes\n',
    },
    file_flow_source: createFlowSource([
      '  on: {',
      "    file: 'notes/**/*.md',",
      '  },',
    ]),
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: 'notes/input.md',
        graph_api: resolveGraphApi(undefined),
      }),
    ).resolves.toMatchObject({
      binding_targets: {
        doc: {
          id: 'file:notes/input.md',
          path: 'notes/input.md',
          status: 'manual',
        },
      },
      contract_path: FILE_FLOW_PATH,
      flow_path: FILE_FLOW_PATH,
      task_path: 'notes/input.md',
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('reuses the checked-in graph node when a file trigger matches a Patram file without flow.on.patram', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    file_flow_source: createFlowSource(
      ['  on: {', "    file: 'docs/tasks/**/*.md',", '  },'],
      'app',
    ),
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: TASK_PATH,
        graph_api: resolveGraphApi(undefined),
      }),
    ).resolves.toMatchObject({
      binding_targets: {
        doc: {
          id: 'task:ad-hoc-input',
          path: TASK_PATH,
          status: 'ready',
        },
      },
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('falls back to the flow path when a graph-backed file has no tracked contract', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    file_flow_source: createFlowSource(
      ['  on: {', "    file: 'docs/decisions/**/*.md',", '  },'],
      'app',
    ),
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: DECISION_PATH,
        graph_api: resolveGraphApi(undefined),
      }),
    ).resolves.toMatchObject({
      contract_path: FILE_FLOW_PATH,
      decision_paths: [],
      task_path: DECISION_PATH,
    });
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects ad hoc dispatch when the selected flow workspace is unavailable', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    file_flow_source: createFlowSource(
      ['  on: {', "    file: 'docs/tasks/**/*.md',", '  },'],
      'missing',
    ),
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        file_path: TASK_PATH,
        graph_api: resolveGraphApi(undefined),
      }),
    ).rejects.toThrow(
      `Workspace "missing" is not available for ${FILE_FLOW_PATH}.`,
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

it('rejects prompt dispatch when the prompt flow still defines flow.on.patram', async () => {
  const repo_directory = await createAdHocDispatchRepo({
    prompt_flow_source: createFlowSource([
      '  on: {',
      "    patram: '$class == task and status == ready',",
      '    prompt: true,',
      '  },',
    ]),
  });

  try {
    await expect(
      createAdHocDispatchAssignment(repo_directory, {
        graph_api: resolveGraphApi(undefined),
        prompt_text: 'Oh, hi!',
      }),
    ).rejects.toThrow(
      `Flow ${PROMPT_FLOW_PATH} cannot accept --prompt because it defines flow.on.patram.`,
    );
  } finally {
    await rm(repo_directory, { force: true, recursive: true });
  }
});

/**
 * @param {{
 *   existing_flow_instance_id?: string,
 *   extra_files?: Record<string, string>,
 *   file_flow_source?: string,
 *   prompt_flow_source?: string,
 *   second_prompt_flow?: boolean,
 *   task_status?: string,
 * }} [options]
 * @returns {Promise<string>}
 */
async function createAdHocDispatchRepo(options = {}) {
  const repo_directory = await createFixtureRepoFromFiles(
    'pravaha-ad-hoc-dispatch-',
    {
      [CONTRACT_PATH]: createFixtureDocument({
        body: '# Ad Hoc Dispatch\n',
        metadata: [
          ['Kind', 'contract'],
          ['Id', 'ad-hoc'],
          ['Status', 'active'],
          ['Decided by', DECISION_PATH],
        ],
      }),
      [DECISION_PATH]: createFixtureDocument({
        body: '# Ad Hoc Dispatch\n',
        metadata: [
          ['Kind', 'decision'],
          ['Id', 'ad-hoc'],
          ['Status', 'accepted'],
          ['Tracked in', PLAN_PATH],
        ],
      }),
      ...(options.extra_files ?? {}),
      [FILE_FLOW_PATH]:
        options.file_flow_source ??
        createFlowSource([
          '  on: {',
          "    file: 'docs/tasks/**/*.md',",
          "    patram: '$class == task and status == ready',",
          '  },',
        ]),
      [PROMPT_FLOW_PATH]:
        options.prompt_flow_source ??
        createFlowSource(['  on: {', '    prompt: true,', '  },']),
      ...(options.second_prompt_flow === true
        ? {
            'docs/flows/runtime/second-prompt-flow.js': createFlowSource([
              '  on: {',
              '    prompt: true,',
              '  },',
            ]),
          }
        : {}),
      [PLAN_PATH]: createFixtureDocument({
        body: '# Ad Hoc Dispatch Plan\n',
        metadata: [
          ['Kind', 'plan'],
          ['Id', 'ad-hoc'],
          ['Status', 'active'],
        ],
      }),
      [TASK_PATH]: createFixtureDocument({
        body: '# Ad Hoc Input\n',
        metadata: [
          ['Kind', 'task'],
          ['Id', 'ad-hoc-input'],
          ['Status', options.task_status ?? 'ready'],
          ['Tracked in', CONTRACT_PATH],
        ],
      }),
    },
    {
      pravaha_config_override: {
        flows: [
          FILE_FLOW_PATH,
          PROMPT_FLOW_PATH,
          'docs/flows/runtime/second-prompt-flow.js',
        ],
        workspaces: {
          app: {
            base_path: '.pravaha/worktrees/app',
            mode: 'ephemeral',
            ref: 'main',
            source: {
              kind: 'repo',
            },
          },
        },
      },
    },
  );

  await linkPravahaPackage(repo_directory);

  if (typeof options.existing_flow_instance_id === 'string') {
    await mkdir(join(repo_directory, '.pravaha/runtime'), { recursive: true });
    await writeFile(
      join(
        repo_directory,
        '.pravaha/runtime',
        `${options.existing_flow_instance_id}.json`,
      ),
      JSON.stringify(
        createRuntimeRecord({
          contract_path: CONTRACT_PATH,
          flow_instance_id: options.existing_flow_instance_id,
          flow_path: FILE_FLOW_PATH,
          outcome: 'success',
          task_id: `dispatch-${options.existing_flow_instance_id}`,
          task_path: TASK_PATH,
        }),
      ),
    );
  }

  return repo_directory;
}

/**
 * @param {string[]} on_lines
 * @param {string} [workspace_id]
 * @returns {string}
 */
function createFlowSource(on_lines, workspace_id = 'app') {
  return [
    "import { defineFlow } from 'pravaha/flow';",
    '',
    'export default defineFlow({',
    ...on_lines,
    `  workspace: '${workspace_id}',`,
    '  async main(ctx) {',
    '    void ctx;',
    '  },',
    '});',
    '',
  ].join('\n');
}
