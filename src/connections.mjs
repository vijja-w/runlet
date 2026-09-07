import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connectionRoot = path.join(
  process.env.RUNLET_STATE_DIR ? path.resolve(process.env.RUNLET_STATE_DIR) : path.join(appRoot, '.runlet'),
  'connections',
);

async function prepareMarketplace(provider) {
  const source = path.join(appRoot, 'distribution', provider);
  const destination = path.join(connectionRoot, provider);
  const pluginDirectory = path.join(destination, 'plugins', 'runlet');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(connectionRoot, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
  const mcp = {
    mcpServers: {
      runlet: {
        command: process.execPath,
        args: [path.join(appRoot, 'bin', 'runlet.mjs'), 'mcp'],
        ...(provider === 'codex' ? { enabled: true, startup_timeout_sec: 20 } : {}),
      },
    },
  };
  await fs.writeFile(path.join(pluginDirectory, '.mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);
  return destination;
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, { timeout: 25_000, maxBuffer: 4 * 1024 * 1024, ...options });
}

async function findExecutable(name) {
  const candidates = name === 'codex'
    ? ['codex', '/Applications/ChatGPT.app/Contents/Resources/codex']
    : [
        'claude',
        path.join(os.homedir(), '.local', 'bin', 'claude'),
        path.join(os.homedir(), '.claude', 'local', 'claude'),
      ];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !await fs.access(candidate).then(() => true).catch(() => false)) continue;
    try {
      await run(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {}
  }
  return null;
}

async function output(command, args) {
  try {
    const result = await run(command, args);
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch (error) {
    return `${error.stdout || ''}\n${error.stderr || ''}`;
  }
}

function codexInstallations(value) {
  return [...value.matchAll(/\brunlet@([A-Za-z0-9_-]+)\s+installed(?:,\s*enabled)?/gi)].map((match) => `runlet@${match[1]}`);
}

async function codexStatus() {
  const command = await findExecutable('codex');
  if (!command) return { id: 'codex', name: 'Codex', available: false, connected: false, status: 'Not installed', invocation: '@Runlet' };
  const listing = await output(command, ['plugin', 'list']);
  const installations = codexInstallations(listing);
  return {
    id: 'codex',
    name: 'Codex',
    available: true,
    connected: installations.length > 0,
    status: installations.length ? 'Connected' : 'Ready to connect',
    invocation: '@Runlet',
    note: installations.length ? 'Start a new Codex task after connecting or updating.' : 'Adds Runlet as a local Codex plugin.',
  };
}

async function claudeStatus() {
  const command = await findExecutable('claude');
  if (!command) return { id: 'claude', name: 'Claude Code', available: false, connected: false, status: 'Not installed', invocation: '/runlet:use' };
  const listing = await output(command, ['plugin', 'list', '--json']);
  const connected = /runlet@runlet-local/i.test(listing);
  return {
    id: 'claude',
    name: 'Claude Code',
    available: true,
    connected,
    status: connected ? 'Connected' : 'Ready to connect',
    invocation: '/runlet:use',
    note: connected ? 'Restart Claude Code or run /reload-plugins after updating.' : 'Adds Runlet tools and the /runlet:use shortcut.',
  };
}

export async function listConnections() {
  return Promise.all([codexStatus(), claudeStatus()]);
}

export async function connect(provider) {
  if (provider === 'codex') {
    const command = await findExecutable('codex');
    if (!command) throw new Error('Codex is not installed on this computer.');
    if ((await codexStatus()).connected) return codexStatus();
    const codexMarketplace = await prepareMarketplace('codex');
    const marketplaces = await output(command, ['plugin', 'marketplace', 'list']);
    if (!marketplaces.includes(codexMarketplace) && !/Marketplace `runlet`/i.test(marketplaces)) {
      await run(command, ['plugin', 'marketplace', 'add', codexMarketplace]);
    }
    await run(command, ['plugin', 'add', 'runlet@runlet']);
    return codexStatus();
  }
  if (provider === 'claude') {
    const command = await findExecutable('claude');
    if (!command) throw new Error('Claude Code is not installed on this computer.');
    if ((await claudeStatus()).connected) return claudeStatus();
    const claudeMarketplace = await prepareMarketplace('claude');
    const marketplaces = await output(command, ['plugin', 'marketplace', 'list', '--json']);
    if (!marketplaces.includes(claudeMarketplace) && !/runlet-local/i.test(marketplaces)) {
      await run(command, ['plugin', 'marketplace', 'add', claudeMarketplace, '--scope', 'user']);
    }
    await run(command, ['plugin', 'install', 'runlet@runlet-local', '--scope', 'user', '--yes']);
    return claudeStatus();
  }
  throw new Error('Unsupported AI connection.');
}

export async function disconnect(provider) {
  if (provider === 'codex') {
    const command = await findExecutable('codex');
    if (!command) throw new Error('Codex is not installed on this computer.');
    const installations = codexInstallations(await output(command, ['plugin', 'list']));
    for (const installation of installations) await run(command, ['plugin', 'remove', installation]);
    return codexStatus();
  }
  if (provider === 'claude') {
    const command = await findExecutable('claude');
    if (!command) throw new Error('Claude Code is not installed on this computer.');
    if ((await claudeStatus()).connected) await run(command, ['plugin', 'uninstall', 'runlet@runlet-local', '--scope', 'user']);
    return claudeStatus();
  }
  throw new Error('Unsupported AI connection.');
}
