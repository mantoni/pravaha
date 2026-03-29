import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export { createSuccessRunResult, installFakeCodexExecutable };

/**
 * @returns {{
 *   finalResponse: string,
 *   items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *   usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 * }}
 */
function createSuccessRunResult() {
  return {
    finalResponse: JSON.stringify({
      summary: 'Observed the ready task and reported completion.',
    }),
    items: [
      {
        id: 'message-1',
        text: 'Observed the ready task and reported completion.',
        type: 'agent_message',
      },
    ],
    usage: {
      cached_input_tokens: 0,
      input_tokens: 120,
      output_tokens: 40,
    },
  };
}

/**
 * @param {string} repo_directory
 * @returns {Promise<string>}
 */
async function installFakeCodexExecutable(repo_directory) {
  const executable_path = join(repo_directory, 'fake-codex.js');

  await writeFile(executable_path, createFakeCodexSource(), 'utf8');
  await chmod(executable_path, 0o755);

  return executable_path;
}

/**
 * @returns {string}
 */
function createFakeCodexSource() {
  return [
    ...createFakeCodexPrelude(),
    ...createFakeCodexMain(),
    ...createFakeCodexReadPromptSource(),
    ...createFakeCodexJsonEventSource(),
    '',
  ].join('\n');
}

/**
 * @returns {string[]}
 */
function createFakeCodexPrelude() {
  return [
    '#!/usr/bin/env node',
    "import { writeFile } from 'node:fs/promises';",
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createFakeCodexMain() {
  return [
    'const args = process.argv.slice(2);',
    "const json_mode = args.includes('--json');",
    "const output_flag_index = args.indexOf('--output-last-message');",
    'const output_path =',
    '  output_flag_index === -1 ? null : args[output_flag_index + 1] ?? null;',
    "const prompt = await readPrompt(args.at(-1) === '-' ? process.stdin : null);",
    "const expected_prompt = process.env.PRAVAHA_TEST_CODEX_EXPECT_PROMPT ?? '';",
    '',
    "if (expected_prompt !== '' && !prompt.includes(expected_prompt)) {",
    '  console.error(`Prompt mismatch: ${prompt}`);',
    '  process.exit(1);',
    '}',
    '',
    'if (json_mode && process.env.PRAVAHA_TEST_CODEX_JSON_EVENTS) {',
    '  process.stdout.write(renderJsonEvents(process.env.PRAVAHA_TEST_CODEX_JSON_EVENTS));',
    '} else if (process.env.PRAVAHA_TEST_CODEX_STDOUT) {',
    '  process.stdout.write(process.env.PRAVAHA_TEST_CODEX_STDOUT);',
    '}',
    'if (process.env.PRAVAHA_TEST_CODEX_STDERR) {',
    '  process.stderr.write(process.env.PRAVAHA_TEST_CODEX_STDERR);',
    '}',
    '',
    'if (output_path !== null && process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE) {',
    '  await writeFile(output_path, process.env.PRAVAHA_TEST_CODEX_LAST_MESSAGE);',
    '}',
    '',
    'if (process.env.PRAVAHA_TEST_CODEX_EXIT_CODE) {',
    '  process.exit(Number(process.env.PRAVAHA_TEST_CODEX_EXIT_CODE));',
    '}',
    '',
    'process.exit(0);',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createFakeCodexReadPromptSource() {
  return [
    '/**',
    ' * @param {NodeJS.ReadStream | null} stdin',
    ' * @returns {Promise<string>}',
    ' */',
    'function readPrompt(stdin) {',
    '  if (stdin === null) {',
    "    return Promise.resolve('');",
    '  }',
    '',
    '  return new Promise((resolve, reject) => {',
    "    let prompt_text = '';",
    "    stdin.setEncoding('utf8');",
    "    stdin.on('data', (chunk) => {",
    '      prompt_text += chunk;',
    '    });',
    "    stdin.on('end', () => {",
    '      resolve(prompt_text);',
    '    });',
    "    stdin.on('error', reject);",
    '  });',
    '}',
    '',
  ];
}

/**
 * @returns {string[]}
 */
function createFakeCodexJsonEventSource() {
  return [
    '/**',
    ' * @param {string} json_text',
    ' * @returns {string}',
    ' */',
    'function renderJsonEvents(json_text) {',
    '  const events = JSON.parse(json_text);',
    '',
    '  if (!Array.isArray(events)) {',
    "    throw new TypeError('Expected json events array.');",
    '  }',
    '',
    "  return events.map((event) => JSON.stringify(event)).join('\\n') + '\\n';",
    '}',
  ];
}
