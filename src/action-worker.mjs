import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

const logs = [];
function inside(relativePath) {
  const root = path.resolve(workerData.workspacePath);
  const target = path.resolve(root, String(relativePath).replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Action attempted to access a path outside the workspace.');
  return target;
}

const workspace = Object.freeze({
  read: (target) => fs.readFile(inside(target), 'utf8'),
  write: async (target, data) => { const resolved = inside(target); await fs.mkdir(path.dirname(resolved), { recursive: true }); await fs.writeFile(resolved, typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2)); },
  list: async (target = '.') => (await fs.readdir(inside(target), { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })),
  exists: (target) => fs.access(inside(target)).then(() => true).catch(() => false),
  mkdir: (target) => fs.mkdir(inside(target), { recursive: true }),
  delete: (target) => fs.rm(inside(target), { recursive: true }),
  fetch: async (url, options = {}) => { if (!/^https:\/\//i.test(url)) throw new Error('Only HTTPS requests are allowed.'); const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }); return { ok: response.ok, status: response.status, text: () => response.text(), json: () => response.json() }; },
});
const run = Object.freeze({ log(message) { logs.push(String(message)); } });

try {
  const source = await fs.readFile(path.join(workerData.actionDir, 'run.js'), 'utf8');
  if (!/export\s+default/.test(source)) throw new Error('run.js must export one default function.');
  const transformed = `let __action; ${source.replace(/export\s+default/, '__action =')}\n;__action;`;
  const context = vm.createContext({ console: Object.freeze({ log: (...values) => logs.push(values.join(' ')) }), setTimeout, clearTimeout, TextEncoder, TextDecoder, URL }, { codeGeneration: { strings: false, wasm: false } });
  const action = new vm.Script(transformed, { filename: 'run.js' }).runInContext(context, { timeout: 1_000 });
  if (typeof action !== 'function') throw new Error('The default export in run.js must be a function.');
  await action({ workspace, run, input: Object.freeze({ ...(workerData.input || {}) }) });
  parentPort.postMessage({ ok: true, kind: 'script', status: 'completed', logs });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error), logs });
}
