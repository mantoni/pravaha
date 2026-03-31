import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import package_json from '../package.json' with { type: 'json' };

it('installs husky and wires pre-commit to the package checks', async () => {
  expect(package_json.dependencies).toMatchObject({
    patram: '^0.11.0',
  });
  expect(package_json.devDependencies).toMatchObject({
    husky: asMatcher(expect.any(String)),
    knip: asMatcher(expect.any(String)),
    'lint-staged': asMatcher(expect.any(String)),
  });
  expect(package_json.scripts).toMatchObject({
    'check:knip': 'knip',
    'check:knip:production': 'knip --production --include exports',
    'check:patram': 'patram check && node ./bin/pravaha.js validate',
    'check:staged': 'lint-staged',
    prepare: 'husky',
  });
  const all_script = package_json.scripts.all;

  expect(all_script).toContain('npm run check:knip');
  expect(all_script).toContain('npm run check:types');
  expect(all_script).toContain('npm run check:patram');
  expect(all_script).toContain('npm run test:coverage');
  expect(all_script).not.toMatch(/(^|&& )npm run test($| &&)/);
  expect(package_json['lint-staged']).toEqual({
    '*.{js,ts,json,md}': 'prettier --check',
    '*.{js,ts}': [
      'eslint',
      "vitest related --run --passWithNoTests --tagsFilter='!lint-staged-excluded'",
    ],
  });

  const pre_commit_hook = await readTextFile(
    new URL('../.husky/pre-commit', import.meta.url),
  );

  expect(pre_commit_hook).toContain('npm run check:staged');
});

it('wires pre-push to a shell-based fixup check', async () => {
  expect(package_json.scripts).not.toHaveProperty('check:fixups');

  const pre_push_hook = await readTextFile(
    new URL('../.husky/pre-push', import.meta.url),
  );

  expect(pre_push_hook).toContain("git rev-parse --verify '@{u}'");
  expect(pre_push_hook).toContain('git log --format=%s @{u}..HEAD');
  expect(pre_push_hook).toContain('git log --format=%s HEAD --not --remotes');
  expect(pre_push_hook).toContain("grep -qE '^(fixup!|squash!)'");
});

/**
 * @param {URL} file_url
 * @returns {Promise<string>}
 */
async function readTextFile(file_url) {
  return readFile(file_url, 'utf8');
}

/**
 * @param {unknown} matcher
 * @returns {unknown}
 */
function asMatcher(matcher) {
  return matcher;
}
