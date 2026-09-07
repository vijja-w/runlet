import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  await execFileAsync('codex', ['mcp', 'get', 'runlet']);
  console.log('Runlet is already connected to Codex.');
} catch {
  try {
    await execFileAsync('codex', ['mcp', 'add', 'runlet', '--', process.execPath, path.join(appRoot, 'src', 'mcp-server.mjs')]);
    console.log('Runlet is connected to Codex. Start a new Codex task to use it.');
  } catch (error) {
    console.error('Could not find the Codex CLI. Install or enable Codex, then run this command again.');
    process.exitCode = 1;
  }
}
