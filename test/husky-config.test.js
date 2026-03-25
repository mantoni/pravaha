import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import package_json from '../package.json' with { type: 'json' };

it('installs husky and wires pre-commit to the package checks', async () => {
  expect(package_json.devDependencies).toMatchObject({
    husky: expect.any(String),
    'lint-staged': expect.any(String),
    patram: '^0.5.0',
  });
  expect(package_json.peerDependencies).toMatchObject({
    patram: '^0.5.0',
  });
  expect(package_json.scripts).toMatchObject({
    'check:patram': 'patram check',
    'check:staged': 'lint-staged',
    prepare: 'husky',
  });
  const all_script = package_json.scripts.all;

  expect(all_script).toContain('npm run check:types');
  expect(all_script).toContain('npm run check:patram');
  expect(all_script).toContain('npm run test:coverage');
  expect(all_script).not.toMatch(/(^|&& )npm run test($| &&)/);
  expect(package_json['lint-staged']).toEqual({
    '*.{js,ts,json,md}': 'prettier --check',
    '*.{js,ts}': ['eslint', 'vitest related --run --passWithNoTests'],
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
