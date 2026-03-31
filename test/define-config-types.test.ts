import { expectTypeOf, it } from 'vitest';

import { defineConfig } from 'pravaha/config';

it('infers the public Pravaha config shape from defineConfig', () => {
  const config = defineConfig({
    flows: ['flows/implement-task.js'],
    queue: {
      target_branch: 'main',
      validation_flow: 'flows/validate.js',
    },
    workspaces: {
      app: {
        mode: 'pooled',
        paths: ['.pravaha/worktrees/app'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
      validation: {
        mode: 'ephemeral',
        base_path: '.pravaha/worktrees/validation',
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
  });

  expectTypeOf(config.flows).toEqualTypeOf<string[] | undefined>();
  expectTypeOf(config.queue?.target_branch).toEqualTypeOf<string | undefined>();
  expectTypeOf(config.queue?.validation_flow).toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf(config.workspaces?.app).toMatchTypeOf<
    | {
        mode: 'pooled';
        paths: string[];
        ref: string;
        source: {
          kind: 'repo';
        };
      }
    | {
        mode: 'ephemeral';
        base_path: string;
        ref: string;
        source: {
          kind: 'repo';
        };
      }
    | undefined
  >();
});

it('rejects unsupported defineConfig properties in the public api', () => {
  defineConfig({
    // @ts-expect-error defineConfig should reject unknown top-level properties.
    arbitrary: true,
  });

  defineConfig({
    flows: [
      // @ts-expect-error flows entries must be strings.
      123,
    ],
  });

  defineConfig({
    queue: {
      // @ts-expect-error queue.target_branch must be a string.
      target_branch: 123,
    },
  });

  defineConfig({
    workspaces: {
      app: {
        mode: 'pooled',
        // @ts-expect-error pooled workspaces must not define base_path.
        base_path: '.pravaha/worktrees/app',
        paths: ['.pravaha/worktrees/app'],
        ref: 'main',
        source: {
          kind: 'repo',
        },
      },
    },
  });

  defineConfig({
    workspaces: {
      validation: {
        mode: 'ephemeral',
        base_path: '.pravaha/worktrees/validation',
        ref: 'main',
        source: {
          // @ts-expect-error workspace source.kind must be "repo".
          kind: 'remote',
        },
      },
    },
  });
});
