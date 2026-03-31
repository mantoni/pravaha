import { expectTypeOf, it } from 'vitest';

import { defineFlow, run, type TaskFlowContext } from 'pravaha';

it('infers common flow entry point types from the public defineFlow api', () => {
  const flow_definition = defineFlow({
    main(ctx) {
      expectTypeOf(ctx).toMatchTypeOf<TaskFlowContext>();
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
  expectTypeOf(flow_definition).toMatchTypeOf<{
    main: (ctx: TaskFlowContext) => Promise<unknown>;
  }>();
});
