import { expect, it } from 'vitest';

import { assertValidFlow, defineFlow } from './flow-contract.js';

it('brands flow definitions created with defineFlow', () => {
  const flow_definition = defineFlow({
    /**
     * @param {unknown} ctx
     */
    main(ctx) {
      void ctx;
    },
  });

  expect(
    assertValidFlow(flow_definition, 'docs/flows/runtime/test-flow.js'),
  ).toBe(flow_definition);
});

it('rejects invalid flow definition inputs and unbranded exports', () => {
  expect(() =>
    defineFlow(
      /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (null)),
    ),
  ).toThrow('Flow definition must be an object.');
  expect(() =>
    assertValidFlow(
      {
        /**
         * @param {unknown} ctx
         */
        main(ctx) {
          void ctx;
        },
      },
      'docs/flows/runtime/test-flow.js',
    ),
  ).toThrow(
    'Flow module "docs/flows/runtime/test-flow.js" must default-export defineFlow(...).',
  );
});
