import package_json from '../package.json' with { type: 'json' };

/**
 * @param {string[]} cli_arguments
 * @param {{ stderr: { write(chunk: string): boolean }, stdout: { write(chunk: string): boolean } }} io_context
 * @returns {Promise<number>}
 */
export async function main(cli_arguments, io_context) {
  const [command_name] = cli_arguments;

  if (
    command_name === undefined ||
    command_name === 'help' ||
    command_name === '--help' ||
    command_name === '-h'
  ) {
    io_context.stdout.write(renderHelp());

    return 0;
  }

  if (
    command_name === 'version' ||
    command_name === '--version' ||
    command_name === '-v'
  ) {
    io_context.stdout.write(`${package_json.version}\n`);

    return 0;
  }

  io_context.stderr.write(
    `Unknown command: ${command_name}\n\n${renderHelp()}`,
  );

  return 1;
}

/**
 * @returns {string}
 */
function renderHelp() {
  return [
    'pravaha',
    '',
    'Usage:',
    '  pravaha greet [name]',
    '  pravaha version',
    '  pravaha help',
    '',
  ].join('\n');
}
