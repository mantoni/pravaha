export { isHelpCommand, isVersionCommand, renderHelp };

/**
 * @returns {string}
 */
function renderHelp() {
  return [
    'pravaha',
    '',
    'Usage:',
    '  pravaha validate [path]',
    '  pravaha approve --token <run_id> [path]',
    '  pravaha worker [path]',
    '  pravaha dispatch [--flow <flow_instance_id>] [path]',
    '  pravaha queue <init|sync|pull|publish> [path]',
    '  pravaha version',
    '  pravaha help',
    '',
  ].join('\n');
}

/**
 * @param {string | undefined} command_name
 * @returns {boolean}
 */
function isHelpCommand(command_name) {
  return (
    command_name === undefined ||
    command_name === 'help' ||
    command_name === '--help' ||
    command_name === '-h'
  );
}

/**
 * @param {string | undefined} command_name
 * @returns {boolean}
 */
function isVersionCommand(command_name) {
  return (
    command_name === 'version' ||
    command_name === '--version' ||
    command_name === '-v'
  );
}
