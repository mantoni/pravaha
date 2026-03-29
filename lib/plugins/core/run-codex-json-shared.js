export {
  isRecord,
  readJsonLine,
  readNumberField,
  readStringField,
  truncateText,
};

/**
 * @param {unknown} line
 * @returns {Record<string, unknown> | null}
 */
function readJsonLine(line) {
  if (typeof line !== 'string') {
    return null;
  }

  try {
    /** @type {unknown} */
    const parsed_value = JSON.parse(line);

    if (isRecord(parsed_value)) {
      return parsed_value;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} field_names
 * @returns {string | null}
 */
function readStringField(record, field_names) {
  for (const field_name of field_names) {
    if (typeof record[field_name] === 'string' && record[field_name] !== '') {
      return record[field_name];
    }
  }

  return null;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} field_names
 * @returns {number | null}
 */
function readNumberField(record, field_names) {
  for (const field_name of field_names) {
    if (
      typeof record[field_name] === 'number' &&
      Number.isFinite(record[field_name])
    ) {
      return record[field_name];
    }
  }

  return null;
}

/**
 * @param {string} text
 * @param {number} max_length
 * @returns {string}
 */
function truncateText(text, max_length) {
  if (text.length <= max_length) {
    return text;
  }

  return `${text.slice(0, max_length - 3)}...`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
