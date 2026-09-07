#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function normalizedPlatform(value) {
  if (value === 'win32') return 'windows';
  return value;
}

const platform = normalizedPlatform(argument('platform', process.platform));
const arch = argument('arch', process.arch);
const nodePath = path.resolve(argument('node', process.execPath));
const outputDir = path.resolve(argument('output', path.join(appRoot, 'dist')));
const supported = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'windows-x64']);
const target = `${platform}-${arch}`;

if (!supported.has(target)) {
  throw new Error(`Unsupported release target: ${target}`);
}

await fs.access(nodePath);
const nodeRoot = platform === 'windows' ? path.dirname(nodePath) : path.resolve(path.dirname(nodePath), '..');
const nodeLicensePath = path.join(nodeRoot, 'LICENSE');
await fs.access(nodeLicensePath);
const assetBase = `runlet-${target}`;
const buildRoot = path.join(appRoot, 'build', 'release', assetBase);
const packageRoot = path.join(buildRoot, 'runlet');
await fs.rm(buildRoot, { recursive: true, force: true });
await fs.mkdir(path.join(packageRoot, 'runtime'), { recursive: true });

for (const directory of ['bin', 'src', 'public', 'distribution', 'node_modules']) {
  await fs.cp(path.join(appRoot, directory), path.join(packageRoot, directory), { recursive: true });
}
await fs.copyFile(path.join(appRoot, 'package.json'), path.join(packageRoot, 'package.json'));
await fs.copyFile(nodeLicensePath, path.join(packageRoot, 'runtime', 'LICENSE-node.txt'));

if (platform === 'windows') {
  await fs.copyFile(nodePath, path.join(packageRoot, 'runtime', 'node.exe'));
  const launcher = [
    '@echo off',
    'setlocal',
    'set "RUNLET_INSTALL_ROOT=%~dp0"',
    'if not defined RUNLET_STATE_DIR set "RUNLET_STATE_DIR=%LOCALAPPDATA%\\Runlet\\state"',
    'if not defined RUNLET_BIN_PATH set "RUNLET_BIN_PATH=%~f0"',
    '"%~dp0runtime\\node.exe" "%~dp0bin\\runlet.mjs" %*',
    '',
  ].join('\r\n');
  await fs.writeFile(path.join(packageRoot, 'runlet.cmd'), launcher);
} else {
  const runtimeNode = path.join(packageRoot, 'runtime', 'node');
  await fs.copyFile(nodePath, runtimeNode);
  await fs.chmod(runtimeNode, 0o755);
  const launcher = `#!/bin/sh
set -eu

RUNLET_BIN_PATH=$0
RUNLET_LAUNCHER=$0
while [ -L "$RUNLET_LAUNCHER" ]; do
  RUNLET_LINK=$(readlink "$RUNLET_LAUNCHER")
  case "$RUNLET_LINK" in
    /*) RUNLET_LAUNCHER=$RUNLET_LINK ;;
    *) RUNLET_LAUNCHER=$(dirname -- "$RUNLET_LAUNCHER")/$RUNLET_LINK ;;
  esac
done
RUNLET_ROOT=$(CDPATH= cd -- "$(dirname -- "$RUNLET_LAUNCHER")" && pwd)
: "\${RUNLET_STATE_DIR:=\${XDG_STATE_HOME:-$HOME/.local/state}/runlet}"
export RUNLET_STATE_DIR RUNLET_BIN_PATH
export RUNLET_INSTALL_ROOT="$RUNLET_ROOT"
exec "$RUNLET_ROOT/runtime/node" "$RUNLET_ROOT/bin/runlet.mjs" "$@"
`;
  const launcherPath = path.join(packageRoot, 'runlet');
  await fs.writeFile(launcherPath, launcher);
  await fs.chmod(launcherPath, 0o755);
}

await fs.mkdir(outputDir, { recursive: true });
if (platform === 'windows') {
  const assetPath = path.join(outputDir, `${assetBase}.zip`);
  await fs.rm(assetPath, { force: true });
  await execFileAsync('zip', ['-qr', assetPath, 'runlet'], { cwd: buildRoot });
  console.log(assetPath);
} else {
  const assetPath = path.join(outputDir, `${assetBase}.tar.gz`);
  await fs.rm(assetPath, { force: true });
  await execFileAsync('tar', ['-czf', assetPath, '-C', buildRoot, 'runlet']);
  console.log(assetPath);
}
