#!/usr/bin/env node
// clipzi: the command line of https://clipzi.app. See src/commands.mjs.

import { BOOLEAN_FLAGS, COMMANDS, HELP, ToolError } from '../src/commands.mjs';
import { AuthError } from '../src/auth.mjs';
import { parseArgs, print, UsageError } from '../src/util.mjs';

const [name, ...rest] = process.argv.slice(2);

if (!name || name === 'help' || name === '--help' || name === '-h') {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}
if (name === '--version' || name === '-v') {
  const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const command = COMMANDS[name];
if (!command) {
  print({ error: { code: 'unknown_command', message: `No command "${name}". Run clipzi help.` } });
  process.exit(2);
}

try {
  const args = parseArgs(rest, BOOLEAN_FLAGS);
  if (args.flags.help) { process.stdout.write(`${HELP}\n`); process.exit(0); }
  print(await command(args));
} catch (e) {
  if (e instanceof UsageError) { print({ error: { code: 'usage', message: e.message } }); process.exit(2); }
  if (e instanceof AuthError) { print({ error: { code: 'not_signed_in', message: e.message } }); process.exit(3); }
  if (e instanceof ToolError) { print({ error: { code: e.code, message: e.message } }); process.exit(1); }
  print({ error: { code: 'failed', message: e?.message ?? String(e) } });
  process.exit(1);
}
