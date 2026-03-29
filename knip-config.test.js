import { expect, it } from 'vitest';

import knip_config from './knip.json' with { type: 'json' };

it('keeps full-repo knip analysis aware of the test tree', () => {
  expect(knip_config).toMatchObject({
    project: expect.arrayContaining([
      'bin/**/*.js!',
      'lib/**/*.js!',
      'test/**/*.js',
    ]),
    ignoreIssues: {
      'lib/core-plugins/types.ts': ['types'],
      'lib/shared/types/patram-types.ts': ['types'],
    },
  });
});

it('marks publishable runtime sources as production project files', () => {
  expect(knip_config.project).toEqual(
    expect.arrayContaining([
      '*.js!',
      'bin/**/*.js!',
      'lib/**/*.js!',
      'lib/**/*.ts!',
    ]),
  );
  expect(knip_config.project).toEqual(
    expect.arrayContaining(['scripts/**/*.js', 'test/**/*.js']),
  );
});
