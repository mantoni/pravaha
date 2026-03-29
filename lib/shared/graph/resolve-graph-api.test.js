import { expect, it } from 'vitest';

import { resolveGraphApi } from './resolve-graph-api.js';

it('resolves default Patram graph APIs', () => {
  expect(resolveGraphApi(undefined)).toMatchObject({
    load_project_graph: expect.any(Function),
    query_graph: expect.any(Function),
  });
});
