#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = process.env.RUNLET_STATE_DIR
  ? path.resolve(process.env.RUNLET_STATE_DIR)
  : path.join(appRoot, '.runlet');
const servicePath = path.join(runtimeDir, 'service.json');
const logPath = path.join(runtimeDir, 'runlet.log');
const serverPath = path.join(appRoot, 'src', 'server.mjs');
const url = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;

async function readService() {
  try { return JSON.parse(await fs.readFile(servicePath, 'utf8')); }
  catch { return null; }
}

async function health(service) {
  if (!service) return null;
  try {
    const response = await fetch(`${service.url}/api/health`, { signal: AbortSignal.timeout(700) });
    const value = await response.json();
    return value.ok && value.pid === service.pid && value.instanceToken === service.instanceToken ? value : null;
  } catch { return null; }
}

async function waitForHealth(service, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await health(service);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function openBrowser(target) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

async function start({ open = true } = {}) {
  await fs.mkdir(runtimeDir, { recursive: true });
  const current = await readService();
  if (await health(current)) {
    console.log(`Runlet is running at ${current.url}`);
    if (open && process.env.RUNLET_NO_OPEN !== '1') openBrowser(current.url);
    return;
  }

  const instanceToken = crypto.randomBytes(24).toString('hex');
  const log = fsSync.openSync(logPath, 'a');
  const child = spawn(process.execPath, [serverPath], {
    cwd: appRoot,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, NO_OPEN: '1', RUNLET_INSTANCE_TOKEN: instanceToken },
  });
  child.unref();
  fsSync.closeSync(log);
  const service = { pid: child.pid, instanceToken, url, startedAt: new Date().toISOString() };
  await fs.writeFile(servicePath, `${JSON.stringify(service, null, 2)}\n`);
  if (!await waitForHealth(service)) throw new Error(`Runlet did not start. Check ${logPath}`);
  console.log(`Runlet is running at ${url}`);
  if (open && process.env.RUNLET_NO_OPEN !== '1') openBrowser(url);
}

async function status() {
  const service = await readService();
  if (await health(service)) {
    console.log(`Runlet is running at ${service.url}`);
    return;
  }
  console.log('Runlet is not running.');
  process.exitCode = 1;
}

async function kill() {
  const service = await readService();
  if (!await health(service)) {
    console.log('Runlet is not running.');
    return;
  }
  process.kill(service.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 30 && await health(service); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fs.rm(servicePath, { force: true });
  console.log('Runlet stopped.');
}

function isSafeInstallPath(target) {
  if (!target) return false;
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  return resolved !== root && resolved !== path.resolve(os.homedir()) && resolved.length > root.length + 3;
}

async function uninstall() {
  const installRoot = process.env.RUNLET_INSTALL_ROOT;
  const commandPath = process.env.RUNLET_BIN_PATH;
  if (!installRoot) {
    throw new Error('This copy is running from a development checkout. Remove it with npm unlink instead.');
  }
  if (!isSafeInstallPath(installRoot)) throw new Error(`Refusing to remove unsafe install path: ${installRoot}`);

  await kill();

  if (process.platform === 'win32') {
    const cleanupPath = path.join(os.tmpdir(), `runlet-uninstall-${process.pid}.ps1`);
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      'Start-Sleep -Milliseconds 800',
      `Remove-Item -LiteralPath '${installRoot.replaceAll("'", "''")}' -Recurse -Force`,
      `$runletPath = '${installRoot.replaceAll("'", "''")}'`,
      '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
      '$parts = @($userPath -split ";" | Where-Object { $_ -and $_.TrimEnd("\\") -ine $runletPath.TrimEnd("\\") })',
      '[Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")',
      'Remove-Item -LiteralPath $PSCommandPath -Force',
    ].join('\r\n');
    await fs.writeFile(cleanupPath, script);
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cleanupPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log('Runlet is being uninstalled. Open a new PowerShell window to refresh PATH.');
    console.log(`Workspace folders and settings in ${runtimeDir} were not deleted.`);
    return;
  }

  if (commandPath) await fs.rm(commandPath, { force: true });
  console.log('Runlet uninstalled.');
  console.log(`Workspace folders and settings in ${runtimeDir} were not deleted.`);
  await fs.rm(installRoot, { recursive: true, force: true });
}

async function version() {
  console.log(await currentVersion());
}

async function currentVersion() {
  const metadata = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  return metadata.version;
}

function compareVersions(left, right) {
  const leftParts = left.split(/[.-]/).slice(0, 3).map(Number);
  const rightParts = right.split(/[.-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

async function downloadText(target, label) {
  const response = await fetch(target, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Runlet updater' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Could not download ${label} (${response.status}).`);
  return response.text();
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Installer failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`)));
  });
}

async function scheduleWindowsUpdate(installer, installRoot, releaseVersion) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runlet-update-'));
  const installerPath = path.join(temporaryRoot, 'install.ps1');
  const updaterPath = path.join(temporaryRoot, 'update.ps1');
  const escapePowerShell = (value) => String(value).replaceAll("'", "''");
  await fs.writeFile(installerPath, installer);
  await fs.writeFile(updaterPath, [
    '$ErrorActionPreference = \'Stop\'',
    'Start-Sleep -Milliseconds 900',
    `$env:RUNLET_INSTALL_DIR = '${escapePowerShell(installRoot)}'`,
    `$env:RUNLET_VERSION = '${escapePowerShell(releaseVersion)}'`,
    `& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${escapePowerShell(installerPath)}'`,
    `Remove-Item -LiteralPath '${escapePowerShell(temporaryRoot)}' -Recurse -Force`,
  ].join('\r\n'));
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updaterPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`Runlet ${releaseVersion} will finish installing in the background.`);
  console.log('Open a new PowerShell window in a moment, then run: runlet version');
}

async function update() {
  const installRoot = process.env.RUNLET_INSTALL_ROOT;
  if (!installRoot) throw new Error('This copy is running from a development checkout and cannot update itself.');
  const installed = await currentVersion();
  console.log(`Installed version: ${installed}`);
  console.log('Checking for updates…');
  const release = JSON.parse(await downloadText('https://api.github.com/repos/vijja-w/runlet/releases/latest', 'the latest release information'));
  const tag = String(release.tag_name || '');
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('GitHub returned an invalid Runlet release version.');
  const available = tag.slice(1);
  if (compareVersions(installed, available) >= 0) {
    console.log(`Runlet ${installed} is up to date.`);
    return;
  }

  console.log(`Updating Runlet ${installed} → ${available}…`);
  const installerName = process.platform === 'win32' ? 'install.ps1' : 'install.sh';
  const installer = await downloadText(`https://raw.githubusercontent.com/vijja-w/runlet/${tag}/${installerName}`, 'the Runlet installer');
  if (process.platform === 'win32') {
    await scheduleWindowsUpdate(installer, installRoot, available);
    return;
  }

  const child = spawn('sh', [], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      RUNLET_INSTALL_DIR: installRoot,
      RUNLET_BIN_DIR: process.env.RUNLET_BIN_PATH && path.resolve(path.dirname(process.env.RUNLET_BIN_PATH)) !== path.resolve(installRoot)
        ? path.dirname(process.env.RUNLET_BIN_PATH)
        : path.join(os.homedir(), '.local', 'bin'),
      RUNLET_VERSION: available,
    },
  });
  child.stdin.end(installer);
  await waitForExit(child);
}

const command = process.argv[2] || 'start';
try {
  if (command === 'mcp') await import('../src/mcp-server.mjs');
  else if (command === 'start' || command === 'open') await start({ open: true });
  else if (command === 'status') await status();
  else if (command === 'kill' || command === 'stop') await kill();
  else if (command === 'uninstall') await uninstall();
  else if (command === 'update') await update();
  else if (command === 'version' || command === '--version' || command === '-v') await version();
  else if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Runlet\n\n  runlet           Start Runlet or open it if already running\n  runlet status    Check whether Runlet is running\n  runlet version   Show the installed version\n  runlet update    Check for and install the latest release\n  runlet kill      Stop Runlet\n  runlet open      Start or open Runlet\n  runlet uninstall Remove the installed app (workspace folders are kept)');
  } else {
    console.error(`Unknown command: ${command}\nRun “runlet help” for available commands.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
