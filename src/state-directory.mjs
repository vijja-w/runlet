import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function bundledRuntimePath(appRoot, platform) {
  return path.join(appRoot, 'runtime', platform === 'win32' ? 'node.exe' : 'node');
}

export function defaultUserStateDirectory({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Runlet', 'state');
  }
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'runlet');
}

export function resolveStateDirectory(appRoot, options = {}) {
  const env = options.env || process.env;
  if (env.RUNLET_STATE_DIR) return path.resolve(env.RUNLET_STATE_DIR);

  const platform = options.platform || process.platform;
  const bundled = options.bundled ?? fs.existsSync(bundledRuntimePath(appRoot, platform));
  if (bundled) return defaultUserStateDirectory({ env, platform, home: options.home });

  return path.join(appRoot, '.runlet');
}
