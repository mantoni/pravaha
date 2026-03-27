import { expect, it } from 'vitest';

import { validateFlowDocument } from './validate-flow-document.js';

it('accepts a valid state-machine flow document', async () => {
  expect(await validateFlow(createValidFlow())).toEqual([]);
});

it('fails fast on removed legacy flow fields', async () => {
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    steps: []'),
    'Legacy field flow.jobs.implement.steps is no longer supported. Rewrite this job as a single uses/end node with next branching.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    needs: [done]'),
    'Legacy field flow.jobs.implement.needs is no longer supported. Rewrite this job as a single uses/end node with next branching.',
  );
  await expectDiagnostic(
    createValidFlow().replace('workspace:', '# workspace:'),
    'Legacy step-based flows are no longer supported. Add flow.workspace and rewrite jobs as state-machine nodes with uses/end plus next.',
  );
});

it('rejects invalid state-machine workspace and next shapes', async () => {
  await expectDiagnostic(
    createValidFlow().replace('    kind: repo', '    kind: remote'),
    'Expected flow.workspace.source.kind to be "repo".',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    next: missing'),
    'Unknown next target "missing" at flow.jobs.implement.next.',
  );
});

it('rejects malformed workspace source and materialize fields', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      ['  source:', '    kind: repo', '    id: app'].join('\n'),
      '  source: nope',
    ),
    'Expected flow.workspace.source to be an object.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    id: app', '    id: ""'),
    'Expected flow.workspace.source.id to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      [
        '  materialize:',
        '    kind: worktree',
        '    mode: ephemeral',
        '    ref: main',
      ].join('\n'),
      '  materialize: nope',
    ),
    'Expected flow.workspace.materialize to be an object.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    kind: worktree', '    kind: checkout'),
    'Expected flow.workspace.materialize.kind to be "worktree".',
  );
  await expectDiagnostic(
    createValidFlow().replace('    ref: main', '    ref: ""'),
    'Expected flow.workspace.materialize.ref to be a non-empty string.',
  );
});

it('rejects malformed trigger bindings and malformed next branches', async () => {
  await expectDiagnostic(
    createValidFlow().replace('  task:', '  document:'),
    'Reserved trigger binding name "document" is not allowed at flow.on.document.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    where: $class == task and status == ready',
      '    where: [ready]',
    ),
    'Expected flow.on.task.where to be a string.',
  );
  await expectDiagnostic(
    createValidFlow().replace('    next: done', '    next: []'),
    'Expected flow.jobs.implement.next to be a non-empty string target or a non-empty branch list.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: done', '      - goto: done'].join('\n'),
    ),
    'Only the final flow.jobs.implement.next branch may omit if.',
  );
});

it('rejects malformed limits and missing trigger definitions', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits:', '      nope: 1', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits.max-visits to be defined.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      ['on:', '  task:', '    where: $class == task and status == ready'].join(
        '\n',
      ),
      '',
    ),
    'Expected flow.on to define exactly one durable trigger binding.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      ['on:', '  task:', '    where: $class == task and status == ready'].join(
        '\n',
      ),
      'on: ready',
    ),
    'Expected flow.on to be an object.',
  );
});

it('rejects malformed state-machine job definitions and terminal-job misuse', async () => {
  await expectDiagnostic(
    createValidFlow().replace('    uses: core/agent', '    uses:'),
    'Expected flow.jobs.implement.uses to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  done:\n    end: success',
      ['  done:', '    end: success', '    next: implement'].join('\n'),
    ),
    'Did not expect flow.jobs.done.next on a terminal end job.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  done:\n    end: success',
      ['  done:', '    end:', '      status: success'].join('\n'),
    ),
    'Expected flow.jobs.done.end to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '  implement:',
      ['  inspect:', '    with: {}', '  implement:'].join('\n'),
    ),
    'Expected flow.jobs.inspect to define a supported state-machine job.',
  );
});

it('rejects malformed next branches and invalid visit limits', async () => {
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - done'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0] to be an object.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: ""'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0].goto to be a non-empty string.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - if: ""', '        goto: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.next[0].if to be a non-empty string when present.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    next:', '      - goto: missing'].join('\n'),
    ),
    'Unknown next target "missing" at flow.jobs.implement.next[0].goto.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits:', '      max-visits: 0', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits.max-visits to be a positive integer.',
  );
  await expectDiagnostic(
    createValidFlow().replace(
      '    next: done',
      ['    limits: nope', '    next: done'].join('\n'),
    ),
    'Expected flow.jobs.implement.limits to be an object.',
  );
});

/**
 * @param {string} flow_document_text
 * @returns {Promise<Awaited<ReturnType<typeof validateFlowDocument>>>}
 */
function validateFlow(flow_document_text) {
  return validateFlowDocument(flow_document_text, 'flow.md', null);
}

/**
 * @param {string} flow_document_text
 * @param {string} message
 * @returns {Promise<void>}
 */
async function expectDiagnostic(flow_document_text, message) {
  expect(await validateFlow(flow_document_text)).toContainEqual({
    file_path: 'flow.md',
    message,
  });
}

/**
 * @returns {string}
 */
function createValidFlow() {
  return [
    '```yaml',
    'on:',
    '  task:',
    '    where: $class == task and status == ready',
    'workspace:',
    '  type: git.workspace',
    '  source:',
    '    kind: repo',
    '    id: app',
    '  materialize:',
    '    kind: worktree',
    '    mode: ephemeral',
    '    ref: main',
    'jobs:',
    '  implement:',
    '    uses: core/agent',
    '    with:',
    '      provider: codex-sdk',
    '      prompt: Implement it.',
    '    next: done',
    '  done:',
    '    end: success',
    '```',
    '',
  ].join('\n');
}
