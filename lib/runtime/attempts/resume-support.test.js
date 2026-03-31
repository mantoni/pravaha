/** @import * as patram from 'patram'; */

import { beforeEach, expect, it, vi } from 'vitest';

const { loadPravahaConfig, createConcreteWorkspaceDefinition } = vi.hoisted(
  () => {
    return {
      createConcreteWorkspaceDefinition: vi.fn(),
      loadPravahaConfig: vi.fn(),
    };
  },
);

vi.mock('../../config/load-pravaha-config.js', () => {
  return {
    loadPravahaConfig,
  };
});

vi.mock('../workspaces/runtime-files.js', () => {
  return {
    createConcreteWorkspaceDefinition,
  };
});

const {
  collectDecisionPaths,
  refreshBindingTargets,
  resolveResumeWorkspaceDefinition,
} = await import('./resume-support.js');

beforeEach(() => {
  createConcreteWorkspaceDefinition.mockReset();
  loadPravahaConfig.mockReset();
});

it('resolves the recorded workspace path through configured workspaces', async () => {
  createConcreteWorkspaceDefinition.mockReturnValue({
    id: 'app',
    location: {
      path: '/repo/.pravaha/worktrees/app',
    },
    mode: 'ephemeral',
    ref: 'main',
    source: {
      kind: 'repo',
    },
  });
  loadPravahaConfig.mockResolvedValue({
    config: {
      workspace_config: {
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
    diagnostics: [],
  });

  await expect(
    resolveResumeWorkspaceDefinition('/repo', 'app', {
      identity: '/repo/.pravaha/worktrees/app',
      mode: 'ephemeral',
      path: '/repo/.pravaha/worktrees/app',
    }),
  ).resolves.toEqual({
    id: 'app',
    location: {
      path: '/repo/.pravaha/worktrees/app',
    },
    mode: 'ephemeral',
    ref: 'main',
    source: {
      kind: 'repo',
    },
  });
});

it('rejects malformed config', async () => {
  loadPravahaConfig.mockResolvedValueOnce({
    diagnostics: [
      {
        file_path: '/repo/pravaha.config.js',
        message: 'Broken config.',
      },
    ],
  });
  await expect(
    resolveResumeWorkspaceDefinition('/repo', 'app', undefined),
  ).rejects.toThrow('/repo/pravaha.config.js: Broken config.');
});

it('rejects missing configured workspaces', async () => {
  loadPravahaConfig.mockResolvedValueOnce({
    config: {
      workspace_config: {},
    },
    diagnostics: [],
  });
  await expect(
    resolveResumeWorkspaceDefinition('/repo', 'app', undefined),
  ).rejects.toThrow(
    'Flow workspace "app" is not defined in pravaha.config.js workspaces.',
  );
});

it('rejects resumed runtimes that omit the recorded workspace path', async () => {
  loadPravahaConfig.mockResolvedValueOnce({
    config: {
      workspace_config: {
        app: {
          mode: 'ephemeral',
        },
      },
    },
    diagnostics: [],
  });
  await expect(
    resolveResumeWorkspaceDefinition('/repo', 'app', undefined),
  ).rejects.toThrow(
    'Expected a resumed runtime record to include the selected workspace path.',
  );
});

it('refreshes runtime bindings and preserves fallback status when the graph omits it', () => {
  expect(
    refreshBindingTargets(
      {
        edges: [],
        nodes: {
          'task:demo': {
            id: 'task:demo',
            $id: 'task:demo',
            $path: 'docs/tasks/runtime/demo.md',
          },
        },
      },
      {
        doc: {
          id: 'task:demo',
          path: 'docs/tasks/runtime/demo.md',
          status: 'ready',
        },
        skipped: undefined,
      },
    ),
  ).toEqual({
    doc: {
      id: 'task:demo',
      path: 'docs/tasks/runtime/demo.md',
      status: 'ready',
    },
  });
});

it('rejects missing refreshed binding targets', () => {
  expect(() =>
    refreshBindingTargets(
      {
        edges: [],
        nodes: {},
      },
      {
        doc: {
          id: 'task:demo',
          path: 'docs/tasks/runtime/demo.md',
          status: 'ready',
        },
      },
    ),
  ).toThrow(
    'Expected runtime binding task:demo (docs/tasks/runtime/demo.md) to exist in the current project graph.',
  );
});

it('rejects malformed refreshed binding targets', () => {
  expect(() =>
    refreshBindingTargets(
      {
        edges: [],
        nodes: {
          'task:demo': {
            id: 'task:demo',
            $id: 'task:demo',
            status: 'ready',
          },
        },
      },
      {
        doc: {
          id: 'task:demo',
          path: 'docs/tasks/runtime/demo.md',
          status: 'ready',
        },
      },
    ),
  ).toThrow(
    'Expected runtime binding task:demo (docs/tasks/runtime/demo.md) to expose graph identity and path.',
  );
});

it('sorts decision paths and ignores unrelated edges', () => {
  expect(
    collectDecisionPaths(
      {
        edges: [
          createGraphEdge('contract:demo', 'decided_by', 'decision:b'),
          createGraphEdge('contract:demo', 'decided_by', 'decision:a'),
          createGraphEdge('contract:demo', 'tracked_in', 'plan:demo'),
        ],
        nodes: {
          'contract:demo': {
            id: 'contract:demo',
            $id: 'contract:demo',
            $path: 'docs/contracts/runtime/demo.md',
          },
          'decision:a': {
            id: 'decision:a',
            $id: 'decision:a',
            $path: 'docs/decisions/runtime/a.md',
          },
          'decision:b': {
            id: 'decision:b',
            $id: 'decision:b',
            $path: 'docs/decisions/runtime/b.md',
          },
          'plan:demo': {
            id: 'plan:demo',
            $id: 'plan:demo',
            $path: 'docs/plans/repo/v0.1/demo.md',
          },
        },
      },
      'docs/contracts/runtime/demo.md',
    ),
  ).toEqual(['docs/decisions/runtime/a.md', 'docs/decisions/runtime/b.md']);
});

it('returns no decision paths when the contract is absent from the graph', () => {
  expect(
    collectDecisionPaths(
      {
        edges: [],
        nodes: {},
      },
      'docs/contracts/runtime/missing.md',
    ),
  ).toEqual([]);
});

/**
 * @param {string} from
 * @param {string} relation
 * @param {string} to
 * @returns {patram.PatramGraphEdge}
 */
function createGraphEdge(from, relation, to) {
  return {
    from,
    id: `${from}:${relation}:${to}`,
    origin: {
      column: 1,
      line: 1,
      path: 'docs/contracts/runtime/demo.md',
    },
    relation,
    to,
  };
}
