/* eslint-disable max-lines-per-function */
import { expectTypeOf, it } from 'vitest';

import { defineFlow, run, type TaskFlowContext } from 'pravaha/flow';

it('infers common flow entry point types from the public defineFlow api', () => {
  const flow_definition = defineFlow({
    on: {
      patram: '$class == task and status == ready',
      file: 'docs/tasks/**/*.md',
      prompt: false,
    },

    workspace: 'app',

    main(ctx) {
      expectTypeOf(ctx).toMatchTypeOf<TaskFlowContext>();
      expectTypeOf(ctx.doc).toEqualTypeOf<TaskFlowContext['doc']>();
      expectTypeOf(ctx.state).toEqualTypeOf<Record<string, unknown>>();
      expectTypeOf(ctx.run_id).toEqualTypeOf<string>();
      expectTypeOf(ctx.setState).toEqualTypeOf<
        (next_state: Record<string, unknown>) => Promise<void>
      >();
      return run(ctx, { command: 'printf ok' });
    },

    onApprove(ctx, data) {
      expectTypeOf(ctx).toMatchTypeOf<TaskFlowContext>();
      expectTypeOf(data).toEqualTypeOf<unknown>();
      return undefined;
    },

    onError(ctx, error) {
      expectTypeOf(ctx).toMatchTypeOf<TaskFlowContext>();
      expectTypeOf(error).toEqualTypeOf<unknown>();
      return undefined;
    },
  });
  expectTypeOf(flow_definition.on.patram).toEqualTypeOf<string | undefined>();
  expectTypeOf(flow_definition.on.file).toEqualTypeOf<string | undefined>();
  expectTypeOf(flow_definition.on.prompt).toEqualTypeOf<boolean | undefined>();
  expectTypeOf(flow_definition.workspace).toEqualTypeOf<string>();
});

it('rejects unsupported defineFlow properties in the public api', () => {
  defineFlow({
    on: {
      patram: '$class == task and status == ready',
    },

    workspace: 'app',

    main() {
      return undefined;
    },

    // @ts-expect-error defineFlow should reject unknown top-level properties.
    arbitrary: true,
  });

  defineFlow({
    on: {
      patram: '$class == task and status == ready',
      // @ts-expect-error flow.on should reject unknown properties.
      extra: true,
    },

    workspace: 'app',

    main() {
      return undefined;
    },
  });

  defineFlow({
    on: {
      // @ts-expect-error flow.on.file must be a string.
      file: 123,
    },

    workspace: 'app',

    main() {
      return undefined;
    },
  });

  defineFlow({
    on: {
      // @ts-expect-error flow.on.prompt must be a boolean.
      prompt: 'yes',
    },

    workspace: 'app',

    main() {
      return undefined;
    },
  });

  defineFlow({
    on: {
      // @ts-expect-error flow.on.patram must be a string.
      patram: 123,
    },

    workspace: 'app',

    main() {
      return undefined;
    },
  });

  defineFlow({
    on: {
      patram: '$class == task and status == ready',
    },

    // @ts-expect-error workspace should be a string.
    workspace: {
      id: 'app',
    },

    main() {
      return undefined;
    },
  });
});
