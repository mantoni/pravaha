import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { loadRuntimeSemantics } from './reconcile-semantics.js';

it('loads semantic role and state mappings for the reconciler', async () => {
  const temp_directory = await createTempRepo({
    semantic_roles: {
      task: ['task'],
    },
    semantic_states: {
      ready: ['ready'],
      terminal: ['done', 'dropped'],
    },
  });

  try {
    await expect(loadRuntimeSemantics(temp_directory)).resolves.toEqual({
      ready_states: new Set(['ready']),
      role_targets: new Map([['task', ['task']]]),
      terminal_states: new Set(['done', 'dropped']),
    });
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects missing terminal state mappings', async () => {
  const temp_directory = await createTempRepo({
    semantic_roles: {
      task: ['task'],
    },
    semantic_states: {
      ready: ['ready'],
    },
  });

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Missing terminal semantic mapping in pravaha.json.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a missing pravaha.json file', async () => {
  const temp_directory = await createTempRepo(undefined);

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Cannot load JSON file',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects a pravaha config that is not an object', async () => {
  const temp_directory = await createTempRepo([]);

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Pravaha config must evaluate to an object.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects non-object semantic mapping sections', async () => {
  const temp_directory = await createTempRepo({
    semantic_roles: ['task'],
    semantic_states: {
      ready: ['ready'],
      terminal: ['done'],
    },
  });

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Pravaha config must define object-valued semantic_roles and semantic_states mappings.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects semantic state mappings that are not arrays', async () => {
  const temp_directory = await createTempRepo({
    semantic_roles: {
      task: ['task'],
    },
    semantic_states: {
      ready: 'ready',
      terminal: ['done'],
    },
  });

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Expected semantic_states.ready to be an array.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

it('rejects semantic mappings with empty target values', async () => {
  const temp_directory = await createTempRepo({
    semantic_roles: {
      task: ['task', ''],
    },
    semantic_states: {
      ready: ['ready'],
      terminal: ['done'],
    },
  });

  try {
    await expect(loadRuntimeSemantics(temp_directory)).rejects.toThrow(
      'Expected semantic_roles.task to contain only non-empty strings.',
    );
  } finally {
    await rm(temp_directory, { force: true, recursive: true });
  }
});

/**
 * @param {unknown} config
 * @returns {Promise<string>}
 */
async function createTempRepo(config) {
  const temp_directory = await mkdtemp(join(tmpdir(), 'pravaha-semantics-'));

  if (config !== undefined) {
    await writeFile(
      join(temp_directory, 'pravaha.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  }

  return temp_directory;
}
