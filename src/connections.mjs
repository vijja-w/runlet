import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { strToU8, zipSync } from 'fflate';

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateRoot = process.env.RUNLET_STATE_DIR ? path.resolve(process.env.RUNLET_STATE_DIR) : path.join(appRoot, '.runlet');
const connectionRoot = path.join(stateRoot, 'connections');

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

async function findCodexExecutable() {
  const candidates = ['codex', '/Applications/ChatGPT.app/Contents/Resources/codex'];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !await fs.access(candidate).then(() => true).catch(() => false)) continue;
    try {
      await run(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {}
  }
  return null;
}

async function existingPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}

async function findClaudeDesktop() {
  if (process.platform === 'darwin') {
    const direct = await existingPath([
      '/Applications/Claude.app',
      path.join(os.homedir(), 'Applications', 'Claude.app'),
    ]);
    if (direct) return direct;
    const matches = (await output('/usr/bin/mdfind', ['kMDItemFSName == "Claude.app"']))
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.endsWith('.app'));
    return existingPath(matches);
  }
  if (process.platform === 'win32') {
    return existingPath([
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Claude', 'Claude.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'AnthropicClaude', 'Claude.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Claude', 'Claude.exe'),
    ]);
  }
  return existingPath(['/usr/bin/claude-desktop', '/usr/local/bin/claude-desktop']);
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
  const command = await findCodexExecutable();
  if (!command) return { id: 'codex', name: 'ChatGPT', available: false, connected: false, status: 'Not installed', invocation: '@Runlet' };
  const listing = await output(command, ['plugin', 'list']);
  const installations = codexInstallations(listing);
  return {
    id: 'codex',
    name: 'ChatGPT',
    available: true,
    connected: installations.length > 0,
    status: installations.length ? 'Connected' : 'Ready to connect',
    invocation: '@Runlet',
    note: installations.length ? 'Start a new task after connecting or updating.' : 'Adds Runlet as a local ChatGPT plugin.',
  };
}

async function claudeDesktopStatus() {
  const application = await findClaudeDesktop();
  return {
    id: 'claude-desktop',
    name: 'Claude',
    available: Boolean(application),
    connected: false,
    status: application ? 'Ready to install' : 'Not installed',
    invocation: 'Ask Claude to use Runlet',
    action: 'install',
    actionLabel: 'Install',
    note: application
      ? 'Installs a local Runlet extension. Claude will ask you to approve it.'
      : 'Install Claude to add the local Runlet extension.',
  };
}

export async function createClaudeDesktopExtension() {
  const metadata = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const extensionRoot = path.join(connectionRoot, 'claude-desktop');
  const bundlePath = path.join(extensionRoot, 'runlet.mcpb');
  const serverPath = path.join(appRoot, 'src', 'mcp-server.mjs');
  const wrapper = [
    `process.env.RUNLET_STATE_DIR = ${JSON.stringify(stateRoot)};`,
    `await import(${JSON.stringify(pathToFileURL(serverPath).href)});`,
    '',
  ].join('\n');
  const manifest = {
    $schema: 'https://raw.githubusercontent.com/anthropics/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json',
    manifest_version: '0.4',
    name: 'runlet-local',
    display_name: 'Runlet',
    version: metadata.version,
    description: 'Use registered Runlet workspaces, Scripts, and Prompts from Claude Desktop.',
    long_description: 'Runlet keeps local workspace files, small Scripts, and reusable Prompts together. This extension connects Claude Desktop to the Runlet installation on this computer.',
    author: { name: 'Runlet' },
    repository: { type: 'git', url: 'https://github.com/vijja-w/runlet' },
    homepage: 'https://github.com/vijja-w/runlet',
    server: {
      type: 'node',
      entry_point: 'server/index.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.mjs'],
        env: {},
      },
    },
    tools_generated: true,
    keywords: ['local', 'workspace', 'scripts', 'prompts'],
    compatibility: { platforms: [process.platform] },
  };
  const archive = zipSync({
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    'server/index.mjs': strToU8(wrapper),
  }, { level: 9 });
  await fs.mkdir(extensionRoot, { recursive: true });
  await fs.writeFile(bundlePath, archive);
  return bundlePath;
}

async function openClaudeDesktopExtension(application) {
  const bundlePath = await createClaudeDesktopExtension();
  if (process.platform === 'darwin') await run('/usr/bin/open', ['-a', application, bundlePath]);
  else if (process.platform === 'win32') await run('cmd.exe', ['/d', '/s', '/c', 'start', '', bundlePath]);
  else await run('xdg-open', [bundlePath]);
  return bundlePath;
}

export async function listConnections() {
  return Promise.all([codexStatus(), claudeDesktopStatus()]);
}

export async function connect(provider) {
  if (provider === 'codex') {
    const command = await findCodexExecutable();
    if (!command) throw new Error('ChatGPT is not installed on this computer.');
    if ((await codexStatus()).connected) return codexStatus();
    const codexMarketplace = await prepareMarketplace('codex');
    const marketplaces = await output(command, ['plugin', 'marketplace', 'list']);
    if (!marketplaces.includes(codexMarketplace) && !/Marketplace `runlet`/i.test(marketplaces)) {
      await run(command, ['plugin', 'marketplace', 'add', codexMarketplace]);
    }
    await run(command, ['plugin', 'add', 'runlet@runlet']);
    return codexStatus();
  }
  if (provider === 'claude-desktop') {
    const application = await findClaudeDesktop();
    if (!application) throw new Error('Claude is not installed on this computer.');
    await openClaudeDesktopExtension(application);
    return {
      ...await claudeDesktopStatus(),
      status: 'Finish in Claude',
      message: 'Claude opened the Runlet extension. Approve Install in Claude to finish.',
    };
  }
  throw new Error('Unsupported AI connection.');
}

export async function disconnect(provider) {
  if (provider === 'codex') {
    const command = await findCodexExecutable();
    if (!command) throw new Error('ChatGPT is not installed on this computer.');
    const installations = codexInstallations(await output(command, ['plugin', 'list']));
    for (const installation of installations) await run(command, ['plugin', 'remove', installation]);
    return codexStatus();
  }
  throw new Error('Unsupported AI connection.');
}
