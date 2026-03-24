import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };

it('defines the Patram repo contract for docs and source files', () => {
  expect(patram_config).toEqual(createExpectedPatramConfig());
});

/**
 * @returns {object}
 */
function createExpectedPatramConfig() {
  return {
    include: [
      'README.md',
      'docs/**/*.md',
      'bin/**/*.js',
      'lib/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
    ],
    kinds: {
      document: {
        builtin: true,
      },
    },
    mappings: createExpectedMappings(),
    queries: {
      documentation: {
        where: 'kind=document',
      },
    },
    relations: {
      links_to: {
        builtin: true,
        from: ['document'],
        to: ['document'],
      },
    },
  };
}

/**
 * @returns {object}
 */
function createExpectedMappings() {
  return {
    'document.title': {
      node: {
        field: 'title',
        kind: 'document',
      },
    },
    'jsdoc.link': {
      emit: {
        relation: 'links_to',
        target: 'path',
        target_kind: 'document',
      },
    },
    'markdown.link': {
      emit: {
        relation: 'links_to',
        target: 'path',
        target_kind: 'document',
      },
    },
  };
}
