#!/usr/bin/env node

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(appRoot, '.runlet');
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

const command = process.argv[2] || 'start';
try {
  if (command === 'mcp') await import('../src/mcp-server.mjs');
  else if (command === 'start' || command === 'open') await start({ open: true });
  else if (command === 'status') await status();
  else if (command === 'kill' || command === 'stop') await kill();
  else if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Runlet\n\n  runlet          Start Runlet or open it if already running\n  runlet status   Check whether Runlet is running\n  runlet kill     Stop Runlet\n  runlet open     Start or open Runlet');
  } else {
    console.error(`Unknown command: ${command}\nRun “runlet help” for available commands.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
