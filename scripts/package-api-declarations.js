import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const script_path = fileURLToPath(import.meta.url);
const repo_directory = resolve(dirname(script_path), '..');
const manifest_path = resolve(repo_directory, '.package-api-declarations.json');
const tsconfig_path = resolve(repo_directory, 'tsconfig.package-types.json');
const typescript_cli_path = resolve(
  repo_directory,
  'node_modules/typescript/bin/tsc',
);
const declaration_source_directories = ['lib', 'test/fixtures'];

/**
 * Builds package API declaration files and records the emitted paths.
 *
 * @returns {Promise<void>}
 */
export async function buildPackageApiDeclarations() {
  await cleanPackageApiDeclarations();

  const command_result = spawnSync(
    process.execPath,
    [typescript_cli_path, '-p', tsconfig_path, '--listEmittedFiles'],
    {
      cwd: repo_directory,
      encoding: 'utf8',
    },
  );

  if (command_result.status !== 0) {
    const output = `${command_result.stdout}${command_result.stderr}`.trim();

    throw new Error(output || 'Failed to build package API declarations.');
  }

  const emitted_file_paths = parseEmittedFilePaths(command_result.stdout);

  await rewriteTypeSpecifierExtensions(emitted_file_paths);

  await writeFile(
    manifest_path,
    `${JSON.stringify({ emitted_file_paths }, null, 2)}\n`,
  );
}

/**
 * Removes generated package API declaration files from the repo.
 *
 * @returns {Promise<void>}
 */
export async function cleanPackageApiDeclarations() {
  const manifest = await loadManifest();
  const discovered_file_paths = await discoverGeneratedDeclarationPaths();
  const emitted_file_paths = new Set(manifest?.emitted_file_paths ?? []);

  for (const relative_file_path of discovered_file_paths) {
    emitted_file_paths.add(relative_file_path);
  }

  for (const relative_file_path of emitted_file_paths) {
    await rm(resolve(repo_directory, relative_file_path), { force: true });
  }

  await rm(manifest_path, { force: true });
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
function parseEmittedFilePaths(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('TSFILE: '))
    .map((line) => line.slice('TSFILE: '.length))
    .map((file_path) => relative(repo_directory, file_path))
    .sort();
}

/**
 * @returns {Promise<{ emitted_file_paths: string[] } | null>}
 */
async function loadManifest() {
  try {
    const manifest_text = await readFile(manifest_path, 'utf8');
    const parsed_manifest = /** @type {unknown} */ (JSON.parse(manifest_text));

    return /** @type {{ emitted_file_paths: string[] }} */ (parsed_manifest);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * @returns {Promise<string[]>}
 */
async function discoverGeneratedDeclarationPaths() {
  /** @type {string[]} */
  const declaration_paths = [];

  for (const directory_path of declaration_source_directories) {
    const absolute_directory_path = resolve(repo_directory, directory_path);
    const directory_paths = await listDeclarationFiles(absolute_directory_path);

    declaration_paths.push(
      ...directory_paths.map((file_path) =>
        relative(repo_directory, file_path),
      ),
    );
  }

  declaration_paths.sort();

  return declaration_paths;
}

/**
 * @param {string} directory_path
 * @returns {Promise<string[]>}
 */
async function listDeclarationFiles(directory_path) {
  const directory_entries = await readdir(directory_path, {
    withFileTypes: true,
  });
  /** @type {string[]} */
  const declaration_paths = [];

  for (const directory_entry of directory_entries) {
    const entry_path = resolve(directory_path, directory_entry.name);

    if (directory_entry.isDirectory()) {
      declaration_paths.push(...(await listDeclarationFiles(entry_path)));
      continue;
    }

    if (directory_entry.isFile() && directory_entry.name.endsWith('.d.ts')) {
      declaration_paths.push(entry_path);
    }
  }

  return declaration_paths;
}

/**
 * Rewrites emitted declaration imports away from repo-only `.ts` specifiers so
 * packed consumers can resolve the generated `.d.ts` files under
 * `moduleResolution: "NodeNext"`.
 *
 * @param {string[]} emitted_file_paths
 * @returns {Promise<void>}
 */
async function rewriteTypeSpecifierExtensions(emitted_file_paths) {
  const typescript_extension_pattern = /(?<!\.d)\.ts(?=(["')]))/g;

  for (const relative_file_path of emitted_file_paths) {
    if (!relative_file_path.endsWith('.d.ts')) {
      continue;
    }

    const absolute_file_path = resolve(repo_directory, relative_file_path);
    const file_text = await readFile(absolute_file_path, 'utf8');
    const rewritten_file_text = file_text.replace(
      typescript_extension_pattern,
      '.d.ts',
    );

    if (rewritten_file_text !== file_text) {
      await writeFile(absolute_file_path, rewritten_file_text);
    }
  }
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isMissingFileError(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
