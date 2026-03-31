import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const patram_bin_path = new URL(
  '../node_modules/patram/bin/patram.js',
  import.meta.url,
);

it('covers every stored Patram query with an executable fixture', async () => {
  const expected_query_results = createExpectedQueryResults();
  const temp_directory = await createFixtureRepo();

  try {
    const query_names = Object.keys(patram_config.queries).sort(compareText);

    expect(query_names).toEqual(
      Object.keys(expected_query_results).sort(compareText),
    );

    for (const query_name of query_names) {
      const actual_result_ids = await runPatramQuery(
        temp_directory,
        query_name,
      );

      expect(actual_result_ids).toEqual(expected_query_results[query_name]);
    }
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
}, 10000);

/**
 * @returns {Record<string, string[]>}
 */
function createExpectedQueryResults() {
  return {
    'active-contracts': [
      'contract:blocked-contract',
      'contract:release-flow',
      'contract:reviewed-contract',
    ],
    'blocked-work': ['contract:blocked-contract', 'task:wait-on-decision'],
    'change-queue': [
      'contract:blocked-contract',
      'contract:release-flow',
      'contract:reviewed-contract',
      'decision:open-question',
      'task:add-tests',
      'task:orphan-task',
      'task:wait-on-decision',
    ],
    'contracts-missing-decisions': [
      'contract:blocked-contract',
      'contract:reviewed-contract',
    ],
    'decision-backlog': ['decision:open-question'],
    'orphan-tasks': ['task:orphan-task'],
    'ready-tasks': ['task:add-tests', 'task:orphan-task'],
    'review-queue': ['contract:reviewed-contract'],
  };
}

/**
 * @returns {Promise<string>}
 */
async function createFixtureRepo() {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-patram-'));
  const fixture_files = createFixtureFiles();

  await writeFile(
    join(temp_directory, '.patram.json'),
    `${JSON.stringify(patram_config, null, 2)}\n`,
  );

  for (const [relative_path, source_text] of Object.entries(fixture_files)) {
    const target_path = join(temp_directory, relative_path);

    await mkdir(dirname(target_path), { recursive: true });
    await writeFile(target_path, source_text);
  }

  return temp_directory;
}

/**
 * @returns {Record<string, string>}
 */
function createFixtureFiles() {
  return {
    ...createContractFixtures(),
    ...createTaskFixtures(),
    ...createDecisionFixtures(),
    ...createFlowFixtures(),
  };
}

/**
 * @param {{ body: string, metadata: Array<[string, string]> }} options
 * @returns {string}
 */
function createFixtureDocument(options) {
  const metadata_lines = options.metadata.map(
    ([label, value]) => `${label}: ${value}`,
  );

  return `---\n${metadata_lines.join('\n')}\n---\n${options.body}`;
}

/**
 * @param {string} temp_directory
 * @param {string} query_name
 * @returns {Promise<string[]>}
 */
async function runPatramQuery(temp_directory, query_name) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [patram_bin_path.pathname, 'query', query_name, '--json'],
    {
      cwd: temp_directory,
      encoding: 'utf8',
    },
  );

  return parseQueryResultIds(stdout).sort(compareText);
}

/**
 * @param {string} left_text
 * @param {string} right_text
 * @returns {number}
 */
function compareText(left_text, right_text) {
  return left_text.localeCompare(right_text, 'en');
}

/**
 * @param {string} query_result_text
 * @returns {string[]}
 */
function parseQueryResultIds(query_result_text) {
  const parsed_output = /** @type {unknown} */ (JSON.parse(query_result_text));

  if (
    parsed_output === null ||
    typeof parsed_output !== 'object' ||
    Array.isArray(parsed_output)
  ) {
    throw new Error('Expected patram query --json to return a results array.');
  }

  const query_result = /** @type {{ results?: unknown }} */ (parsed_output);

  if (!Array.isArray(query_result.results)) {
    throw new Error('Expected patram query --json to return a results array.');
  }

  return query_result.results.flatMap((result) => {
    if (
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result)
    ) {
      const query_id = readObjectProperty(result, '$id');

      if (typeof query_id !== 'string') {
        return [];
      }

      return [query_id];
    }

    return [];
  });
}

/**
 * @param {unknown} object_value
 * @param {string} property_name
 * @returns {unknown}
 */
function readObjectProperty(object_value, property_name) {
  if (
    object_value === null ||
    typeof object_value !== 'object' ||
    Array.isArray(object_value)
  ) {
    return undefined;
  }

  return /** @type {Record<string, unknown>} */ (object_value)[property_name];
}

/**
 * @returns {Record<string, string>}
 */
function createContractFixtures() {
  return {
    'docs/contracts/release-flow.md': createFixtureDocument({
      body: '# Release Flow Contract\n',
      metadata: [
        ['Kind', 'contract'],
        ['Id', 'release-flow'],
        ['Status', 'active'],
        ['Decided by', 'docs/decisions/query-logic.md'],
      ],
    }),
    'docs/contracts/reviewed-contract.md': createFixtureDocument({
      body: '# Reviewed Contract\n',
      metadata: [
        ['Kind', 'contract'],
        ['Id', 'reviewed-contract'],
        ['Status', 'review'],
      ],
    }),
    'docs/contracts/blocked-contract.md': createFixtureDocument({
      body: '# Blocked Contract\n',
      metadata: [
        ['Kind', 'contract'],
        ['Id', 'blocked-contract'],
        ['Status', 'blocked'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createTaskFixtures() {
  return {
    'docs/tasks/release-flow/add-tests.md': createFixtureDocument({
      body: '# Add Tests\n',
      metadata: [
        ['Kind', 'task'],
        ['Id', 'add-tests'],
        ['Status', 'ready'],
        ['Tracked in', 'docs/contracts/release-flow.md'],
      ],
    }),
    'docs/tasks/untracked/orphan-task.md': createFixtureDocument({
      body: '# Orphan Task\n',
      metadata: [
        ['Kind', 'task'],
        ['Id', 'orphan-task'],
        ['Status', 'ready'],
      ],
    }),
    'docs/tasks/release-flow/wait-on-decision.md': createFixtureDocument({
      body: '# Wait On Decision\n',
      metadata: [
        ['Kind', 'task'],
        ['Id', 'wait-on-decision'],
        ['Status', 'blocked'],
        ['Tracked in', 'docs/contracts/release-flow.md'],
        ['Depends on', 'docs/decisions/open-question.md'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createDecisionFixtures() {
  return {
    'docs/decisions/query-logic.md': createFixtureDocument({
      body: '# Query Logic Decision\n',
      metadata: [
        ['Kind', 'decision'],
        ['Id', 'query-logic'],
        ['Status', 'accepted'],
      ],
    }),
    'docs/decisions/open-question.md': createFixtureDocument({
      body: '# Open Question\n',
      metadata: [
        ['Kind', 'decision'],
        ['Id', 'open-question'],
        ['Status', 'proposed'],
      ],
    }),
  };
}

/**
 * @returns {Record<string, string>}
 */
function createFlowFixtures() {
  return {
    'docs/flows/release-flow-root.yaml': ['jobs: {}', ''].join('\n'),
  };
}
