const MAX_LOG_COMMAND_LENGTH = 120;
const MAX_LOG_FILE_CHANGES = 3;

export { readStructuredCodexFailure, renderCodexEventLine };

import {
  isRecord,
  readJsonLine,
  readNumberField,
  readStringField,
  truncateText,
} from './run-codex-json-shared.js';

/**
 * @param {string} line
 * @returns {{ level: 'info' | 'warn', text: string } | null}
 */
function renderCodexEventLine(line) {
  const event = readJsonLine(line);

  if (event === null) {
    return null;
  }

  return readRenderedCodexEvent(event);
}

/**
 * @param {string} stdout_text
 * @returns {string | null}
 */
function readStructuredCodexFailure(stdout_text) {
  const lines = stdout_text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  /** @type {string | null} */
  let failure_message = null;

  for (const line of lines) {
    const event = readJsonLine(line);

    if (event === null) {
      continue;
    }

    if (event.type === 'error' || event.type === 'turn.failed') {
      failure_message = readEventError(event) ?? failure_message;
      continue;
    }

    if (event.type === 'item.failed' && isRecord(event.item)) {
      failure_message = readFailedItemMessage(event.item) ?? failure_message;
    }
  }

  return failure_message;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {{ level: 'info' | 'warn', text: string } | null}
 */
function readRenderedCodexEvent(event) {
  if (typeof event.type !== 'string') {
    return null;
  }

  const basic_event = readBasicCodexEvent(event);

  if (basic_event !== null) {
    return basic_event;
  }

  if (
    (event.type === 'item.completed' || event.type === 'item.failed') &&
    isRecord(event.item)
  ) {
    return renderCodexItemEvent(event.type, event.item);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {{ level: 'info' | 'warn', text: string } | null}
 */
function readBasicCodexEvent(event) {
  if (event.type === 'thread.started') {
    return {
      level: 'info',
      text: 'started',
    };
  }

  if (event.type === 'turn.completed') {
    return {
      level: 'info',
      text: 'completed',
    };
  }

  if (event.type === 'turn.failed') {
    return {
      level: 'warn',
      text: readEventError(event) ?? 'failed',
    };
  }

  if (event.type === 'error') {
    return {
      level: 'warn',
      text: readEventError(event) ?? 'error',
    };
  }

  return null;
}

/**
 * @param {'item.completed' | 'item.failed'} event_type
 * @param {Record<string, unknown>} item
 * @returns {{ level: 'info' | 'warn', text: string } | null}
 */
function renderCodexItemEvent(event_type, item) {
  const command_summary = summarizeCommandItem(event_type, item);

  if (command_summary !== null) {
    return command_summary;
  }

  if (!isFileChangeItem(item)) {
    return null;
  }

  const file_change_summary = summarizeFileChanges(item);

  if (file_change_summary === null) {
    return null;
  }

  return {
    level: event_type === 'item.failed' ? 'warn' : 'info',
    text: file_change_summary,
  };
}

/**
 * @param {'item.completed' | 'item.failed'} event_type
 * @param {Record<string, unknown>} item
 * @returns {{ level: 'info' | 'warn', text: string } | null}
 */
function summarizeCommandItem(event_type, item) {
  if (item.type !== 'command_execution' || typeof item.command !== 'string') {
    return null;
  }

  const prefix = event_type === 'item.failed' ? 'command failed' : 'command';

  return {
    level: event_type === 'item.failed' ? 'warn' : 'info',
    text: `${prefix} ${truncateText(item.command, MAX_LOG_COMMAND_LENGTH)}`,
  };
}

/**
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function isFileChangeItem(item) {
  if (item.type === 'file_change' || item.type === 'file_changes') {
    return true;
  }

  return Array.isArray(item.changes) || Array.isArray(item.files);
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function summarizeFileChanges(item) {
  const raw_changes = Array.isArray(item.changes)
    ? item.changes
    : Array.isArray(item.files)
      ? item.files
      : [item];
  /** @type {string[]} */
  const summaries = [];

  for (const raw_change of raw_changes) {
    if (!isRecord(raw_change)) {
      continue;
    }

    const change_summary = summarizeSingleFileChange(raw_change);

    if (change_summary !== null) {
      summaries.push(change_summary);
    }
  }

  if (summaries.length === 0) {
    return null;
  }

  return renderFileChangeList(summaries);
}

/**
 * @param {string[]} summaries
 * @returns {string}
 */
function renderFileChangeList(summaries) {
  const visible_summaries = summaries.slice(0, MAX_LOG_FILE_CHANGES);
  const hidden_count = summaries.length - visible_summaries.length;
  const summary_suffix = hidden_count > 0 ? `, +${hidden_count} more` : '';

  return `files ${visible_summaries.join(', ')}${summary_suffix}`;
}

/**
 * @param {Record<string, unknown>} change
 * @returns {string | null}
 */
function summarizeSingleFileChange(change) {
  const file_path = readStringField(change, [
    'path',
    'file_path',
    'filePath',
    'filename',
    'file',
  ]);

  if (file_path === null) {
    return null;
  }

  const additions = readNumberField(change, [
    'additions',
    'insertions',
    'added_lines',
    'addedLines',
    'plus',
  ]);
  const deletions = readNumberField(change, [
    'deletions',
    'removals',
    'deleted_lines',
    'deletedLines',
    'minus',
  ]);

  if (additions === null && deletions === null) {
    return file_path;
  }

  return `${file_path} (+${additions ?? 0} -${deletions ?? 0})`;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {string | null}
 */
function readEventError(event) {
  const direct_message = readStringField(event, ['message', 'error']);

  if (direct_message !== null) {
    return truncateText(direct_message, MAX_LOG_COMMAND_LENGTH);
  }

  if (!isRecord(event.error)) {
    return null;
  }

  const nested_message = readStringField(event.error, [
    'message',
    'details',
    'type',
  ]);

  if (nested_message === null) {
    return null;
  }

  return truncateText(nested_message, MAX_LOG_COMMAND_LENGTH);
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string | null}
 */
function readFailedItemMessage(item) {
  const command_summary = summarizeCommandItem('item.failed', item);

  if (command_summary !== null) {
    return command_summary.text;
  }

  const file_change_summary = isFileChangeItem(item)
    ? summarizeFileChanges(item)
    : null;

  if (file_change_summary !== null) {
    return file_change_summary;
  }

  return readStringField(item, ['message']);
}
