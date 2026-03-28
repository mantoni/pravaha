import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const repo_directory = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);
/** @type {Array<[string, string]>} */
const EXPECTED_FACADES = [
  ['lib/pravaha-cli.js', "export { main } from './cli/main.js';\n"],
  [
    'lib/load-flow-definition.js',
    "export { parseFlowDefinition } from './flow/load-flow-definition.js';\n",
  ],
  [
    'lib/reconcile-flow.js',
    [
      'export {',
      '  loadExecutableDispatchFlow,',
      '  loadExecutableFlow,',
      '  loadStateMachineFlow,',
      "} from './flow/reconcile-flow.js';",
      '',
    ].join('\n'),
  ],
  [
    'lib/validate-flow-document.js',
    "export { validateFlowDocument } from './flow/validate-flow-document.js';\n",
  ],
  [
    'lib/validate-repo.js',
    "export { validateRepo } from './repo/validate-repo.js';\n",
  ],
  [
    'lib/create-semantic-model.js',
    "export { createSemanticModel } from './repo/semantics/create-semantic-model.js';\n",
  ],
  [
    'lib/reconcile-semantics.js',
    "export { loadRuntimeSemantics } from './repo/semantics/reconcile-semantics.js';\n",
  ],
  [
    'lib/validate-semantic-mapping.js',
    "export { validateSemanticMapping } from './repo/semantics/validate-semantic-mapping.js';\n",
  ],
  [
    'lib/git-process.js',
    "export { execGitFile } from './shared/git/exec-git-file.js';\n",
  ],
  [
    'lib/validation-helpers.js',
    [
      'export {',
      '  compareText,',
      '  createDiagnostic,',
      '  getErrorMessage,',
      '  isPlainObject,',
      '  listYamlFiles,',
      '  readJsonFile,',
      "} from './shared/diagnostics/validation-helpers.js';",
      '',
    ].join('\n'),
  ],
  ['lib/patram-types.ts', "export * from './shared/types/patram-types.ts';\n"],
  [
    'lib/validation.types.ts',
    "export * from './shared/types/validation.types.ts';\n",
  ],
  [
    'lib/runtime-attempt.js',
    [
      'export {',
      '  resumeTaskAttempt,',
      '  runStateMachineAttempt,',
      "} from './runtime/attempts/state-machine.js';",
      '',
    ].join('\n'),
  ],
  [
    'lib/local-dispatch-runtime.js',
    [
      'export {',
      '  handleDispatcherFollowerMessage,',
      '  handleFollowerMessage,',
      "} from './runtime/dispatch/dispatcher.js';",
      'export {',
      '  createWorkerSignalContext,',
      '  isTransientFollowerRegistrationError,',
      '  waitForRetryInterval,',
      "} from './runtime/dispatch/context.js';",
      'export {',
      '  dispatch,',
      '  startWorkerSession,',
      '  tryListen,',
      '  worker,',
      "} from './runtime/dispatch/session.js';",
      '',
    ].join('\n'),
  ],
  [
    'lib/local-dispatch-protocol.js',
    [
      'export {',
      '  canConnectToDispatcher,',
      '  closeServer,',
      '  createProtocolConnection,',
      '  isAddressInUseError,',
      '  isInitialProbeDisconnect,',
      '  openProtocolConnection,',
      '  parseProtocolMessage,',
      '  removeStaleUnixSocket,',
      '  reportOperatorError,',
      '  resolveDispatchEndpoint,',
      '  waitForMessage,',
      "} from './runtime/dispatch/protocol.js';",
      '',
    ].join('\n'),
  ],
];

it('keeps repo-level tests out of lib', async () => {
  const lib_entries = await readdir(new URL('../lib/', import.meta.url));

  expect(lib_entries).not.toContain('github-actions-config.test.js');
  expect(lib_entries).not.toContain('husky-config.test.js');
  expect(lib_entries).not.toContain('release-config.test.js');
});

it('keeps the migrated subsystem directories in lib', async () => {
  const lib_entries = await readdir(join(repo_directory, 'lib'));
  const runtime_entries = await readdir(join(repo_directory, 'lib/runtime'));

  expect(lib_entries).toEqual(
    expect.arrayContaining(['cli', 'flow', 'repo', 'runtime', 'shared']),
  );
  expect(runtime_entries).toEqual(
    expect.arrayContaining(['attempts', 'dispatch']),
  );
});

it('keeps root compatibility facades for migrated modules', async () => {
  for (const [file_path, expected_text] of EXPECTED_FACADES) {
    const facade_text = await readFile(join(repo_directory, file_path), 'utf8');

    expect(facade_text).toBe(expected_text);
  }
});
