import { expect, it } from 'vitest';

import {
  readStructuredCodexFailure,
  renderCodexEventLine,
} from './run-codex-json.js';
import {
  isRecord,
  readJsonLine,
  readNumberField,
  readStringField,
  truncateText,
} from './run-codex-json-shared.js';

it('returns null for invalid or unsupported codex events', () => {
  expect(renderCodexEventLine('not json')).toBeNull();
  expect(renderCodexEventLine(JSON.stringify({}))).toBeNull();
  expect(
    renderCodexEventLine(JSON.stringify({ type: 'item.started', item: {} })),
  ).toBeNull();
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          type: 'file_changes',
        },
        type: 'item.completed',
      }),
    ),
  ).toBeNull();
});

it('renders basic lifecycle milestones', () => {
  expect(
    renderCodexEventLine(JSON.stringify({ type: 'thread.started' })),
  ).toEqual({
    level: 'info',
    text: 'started',
  });
  expect(
    renderCodexEventLine(JSON.stringify({ type: 'turn.completed' })),
  ).toEqual({
    level: 'info',
    text: 'completed',
  });
  expect(renderCodexEventLine(JSON.stringify({ type: 'turn.failed' }))).toEqual(
    {
      level: 'warn',
      text: 'failed',
    },
  );
  expect(
    renderCodexEventLine(JSON.stringify({ error: {}, type: 'error' })),
  ).toEqual({
    level: 'warn',
    text: 'error',
  });
});

it('renders command items', () => {
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          command: 'bash -lc npm test',
          type: 'command_execution',
        },
        type: 'item.completed',
      }),
    ),
  ).toEqual({
    level: 'info',
    text: 'command bash -lc npm test',
  });
});

it('renders file change items from changes arrays', () => {
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          changes: [
            {
              additions: 3,
              deletions: 1,
              path: 'a.js',
            },
            {
              additions: 2,
              deletions: 0,
              path: 'b.js',
            },
            {
              additions: 1,
              deletions: 4,
              path: 'c.js',
            },
            {
              additions: 9,
              deletions: 2,
              path: 'd.js',
            },
          ],
          type: 'file_changes',
        },
        type: 'item.completed',
      }),
    ),
  ).toEqual({
    level: 'info',
    text: 'files a.js (+3 -1), b.js (+2 -0), c.js (+1 -4), +1 more',
  });
});

it('renders file change items from files arrays', () => {
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          files: [
            {
              filePath: 'alt.js',
              insertions: 6,
              removals: 2,
            },
          ],
        },
        type: 'item.completed',
      }),
    ),
  ).toEqual({
    level: 'info',
    text: 'files alt.js (+6 -2)',
  });
});

it('renders failed command items', () => {
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          command: `bash -lc ${'x'.repeat(160)}`,
          type: 'command_execution',
        },
        type: 'item.failed',
      }),
    ),
  ).toMatchObject({
    level: 'warn',
  });
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          command: `bash -lc ${'x'.repeat(160)}`,
          type: 'command_execution',
        },
        type: 'item.failed',
      }),
    )?.text,
  ).toMatch(/^command failed bash -lc x+\.\.\.$/);
  expect(
    renderCodexEventLine(
      JSON.stringify({
        item: {
          file: 'solo.js',
          type: 'file_change',
        },
        type: 'item.failed',
      }),
    ),
  ).toEqual({
    level: 'warn',
    text: 'files solo.js',
  });
});

it('renders nested error details', () => {
  expect(
    renderCodexEventLine(
      JSON.stringify({
        error: {
          details: 'nested failure',
        },
        type: 'error',
      }),
    ),
  ).toEqual({
    level: 'warn',
    text: 'nested failure',
  });
});

it('returns null when no structured failure is present', () => {
  expect(readStructuredCodexFailure('')).toBeNull();
  expect(
    readStructuredCodexFailure(
      `${JSON.stringify({ type: 'turn.completed' })}\ninvalid`,
    ),
  ).toBeNull();
});

it('prefers explicit error events over failed items', () => {
  expect(
    readStructuredCodexFailure(
      [
        JSON.stringify({
          item: {
            command: 'bash -lc npm test',
            type: 'command_execution',
          },
          type: 'item.failed',
        }),
        JSON.stringify({
          message: 'top level failure',
          type: 'turn.failed',
        }),
      ].join('\n'),
    ),
  ).toBe('top level failure');
});

it('falls back to failed item details', () => {
  expect(
    readStructuredCodexFailure(
      JSON.stringify({
        item: {
          message: 'item specific failure',
          type: 'other',
        },
        type: 'item.failed',
      }),
    ),
  ).toBe('item specific failure');
  expect(
    readStructuredCodexFailure(
      JSON.stringify({
        item: {
          changes: [
            {
              filename: 'alt.js',
            },
          ],
          type: 'file_changes',
        },
        type: 'item.failed',
      }),
    ),
  ).toBe('files alt.js');
  expect(
    readStructuredCodexFailure(
      JSON.stringify({
        error: {
          type: 'fatal',
        },
        type: 'error',
      }),
    ),
  ).toBe('fatal');
});

it('parses json lines and guards records', () => {
  expect(readJsonLine(1)).toBeNull();
  expect(readJsonLine('[]')).toBeNull();
  expect(readJsonLine('{"type":"ok"}')).toEqual({ type: 'ok' });
  expect(readJsonLine('{')).toBeNull();
  expect(isRecord({})).toBe(true);
  expect(isRecord(null)).toBe(false);
});

it('reads string and number fields', () => {
  expect(readStringField({ a: '', b: 'value' }, ['a', 'b'])).toBe('value');
  expect(readStringField({ a: 1 }, ['a'])).toBeNull();
  expect(readNumberField({ a: '1', b: 2 }, ['a', 'b'])).toBe(2);
  expect(readNumberField({ a: Number.NaN }, ['a'])).toBeNull();
});

it('truncates long text', () => {
  expect(truncateText('short', 10)).toBe('short');
  expect(truncateText('123456', 5)).toBe('12...');
});
