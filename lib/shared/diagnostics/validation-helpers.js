/** @import { JsonReadResult, ValidationDiagnostic } from '../types/validation.types.ts' */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export {
  compareText,
  createDiagnostic,
  isPlainObject,
  listYamlFiles,
  readJsonFile,
};

/**
 * @param {string} directory_path
 * @param {ValidationDiagnostic[]} diagnostics
 * @returns {Promise<string[]>}
 */
async function listYamlFiles(directory_path, diagnostics) {
  /** @type {string[]} */
  const yaml_file_paths = [];

  try {
    const directory_entries = await readdir(directory_path, {
      withFileTypes: true,
    });

    for (const directory_entry of directory_entries) {
      const entry_path = join(directory_path, directory_entry.name);

      if (directory_entry.isDirectory()) {
        yaml_file_paths.push(...(await listYamlFiles(entry_path, diagnostics)));
        continue;
      }

      if (
        directory_entry.isFile() &&
        (directory_entry.name.endsWith('.yaml') ||
          directory_entry.name.endsWith('.yml'))
      ) {
        yaml_file_paths.push(entry_path);
      }
    }
  } catch (error) {
    diagnostics.push(
      createDiagnostic(
        directory_path,
        `Cannot read flow directory: ${getErrorMessage(error)}`,
      ),
    );
  }

  return yaml_file_paths.sort(compareText);
}

/**
 * @param {string} file_path
 * @returns {Promise<JsonReadResult>}
 */
async function readJsonFile(file_path) {
  try {
    const file_text = await readFile(file_path, 'utf8');

    return {
      value: JSON.parse(file_text),
      diagnostics: [],
    };
  } catch (error) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic(
          file_path,
          `Cannot load JSON file: ${getErrorMessage(error)}`,
        ),
      ],
    };
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} file_path
 * @param {string} message
 * @returns {ValidationDiagnostic}
 */
function createDiagnostic(file_path, message) {
  return {
    file_path,
    message,
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * @param {string} left_text
 * @param {string} right_text
 * @returns {number}
 */
function compareText(left_text, right_text) {
  return left_text.localeCompare(right_text, 'en');
}
