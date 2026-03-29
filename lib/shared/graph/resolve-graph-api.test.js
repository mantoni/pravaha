import { expect, it } from 'vitest';

import { resolveGraphApi } from './resolve-graph-api.js';

it('resolves default Patram graph APIs', () => {
  expect(resolveGraphApi(undefined)).toMatchObject({
    load_project_graph: asMatcher(expect.any(Function)),
    query_graph: asMatcher(expect.any(Function)),
  });
});

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
