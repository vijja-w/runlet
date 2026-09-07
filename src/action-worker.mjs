import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import { unzipSync, zipSync, strToU8 } from 'fflate';

const logs = [];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfAssetsRoot = path.join(packageRoot, 'node_modules', 'pdfjs-dist');
let pdfJs;

async function loadPdfJs() {
  if (!pdfJs) {
    const warn = console.warn;
    console.warn = (message, ...values) => {
      const text = String(message);
      if (!text.includes('Cannot load "@napi-rs/canvas"') && !text.includes('Cannot polyfill `DOMMatrix`') && !text.includes('Cannot polyfill `Path2D`')) warn(message, ...values);
    };
    try {
      pdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    } finally {
      console.warn = warn;
    }
  }
  return pdfJs;
}
function inside(relativePath) {
  const root = path.resolve(workerData.workspacePath);
  const target = path.resolve(root, String(relativePath).replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Action attempted to access a path outside the workspace.');
  return target;
}

function bytes(value, label = 'data') {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new TypeError(`${label} must be binary data from workspace.readBytes().`);
}

function plain(value) {
  return value === undefined ? undefined : structuredClone(value);
}

const workspace = Object.freeze({
  read: (target) => fs.readFile(inside(target), 'utf8'),
  readBytes: async (target) => Uint8Array.from(await fs.readFile(inside(target))),
  write: async (target, data) => { const resolved = inside(target); await fs.mkdir(path.dirname(resolved), { recursive: true }); await fs.writeFile(resolved, typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2)); },
  writeBytes: async (target, data) => { const resolved = inside(target); await fs.mkdir(path.dirname(resolved), { recursive: true }); await fs.writeFile(resolved, bytes(data)); },
  list: async (target = '.') => (await fs.readdir(inside(target), { withFileTypes: true })).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })),
  exists: (target) => fs.access(inside(target)).then(() => true).catch(() => false),
  mkdir: (target) => fs.mkdir(inside(target), { recursive: true }),
  delete: (target) => fs.rm(inside(target), { recursive: true }),
  fetch: async (url, options = {}) => { if (!/^https:\/\//i.test(url)) throw new Error('Only HTTPS requests are allowed.'); const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }); return { ok: response.ok, status: response.status, text: () => response.text(), json: () => response.json() }; },
});
const run = Object.freeze({ log(message) { logs.push(String(message)); } });
const pdf = Object.freeze({
  async extractText(data) {
    const { getDocument } = await loadPdfJs();
    const loadingTask = getDocument({
      data: bytes(data, 'PDF data'),
      disableWorker: true,
      isEvalSupported: false,
      cMapUrl: `${path.join(pdfAssetsRoot, 'cmaps')}${path.sep}`,
      cMapPacked: true,
      standardFontDataUrl: `${path.join(pdfAssetsRoot, 'standard_fonts')}${path.sep}`,
      wasmUrl: `${path.join(pdfAssetsRoot, 'wasm')}${path.sep}`,
    });
    const document = await loadingTask.promise;
    try {
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .filter((item) => typeof item.str === 'string')
          .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .trim();
        pages.push(text);
        page.cleanup();
      }
      return pages.join('\n\n');
    } finally {
      await loadingTask.destroy();
    }
  },
});
const csv = Object.freeze({
  parse(text, options = {}) { return parseCsv(String(text), plain(options)); },
  stringify(records, options = {}) { return stringifyCsv(plain(records), plain(options)); },
});
const zip = Object.freeze({
  extract(data) {
    return Object.fromEntries(Object.entries(unzipSync(bytes(data, 'ZIP data'))).map(([name, value]) => [name, Uint8Array.from(value)]));
  },
  create(files, options = {}) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new TypeError('ZIP files must be an object keyed by filename.');
    const encoded = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : bytes(value, `ZIP entry ${name}`)]));
    return Uint8Array.from(zipSync(encoded, plain(options)));
  },
});

try {
  const source = await fs.readFile(path.join(workerData.actionDir, 'run.js'), 'utf8');
  if (!/export\s+default/.test(source)) throw new Error('run.js must export one default function.');
  const transformed = `let __action; ${source.replace(/export\s+default/, '__action =')}\n;__action;`;
  const context = vm.createContext({ console: Object.freeze({ log: (...values) => logs.push(values.join(' ')) }), setTimeout, clearTimeout, TextEncoder, TextDecoder, URL }, { codeGeneration: { strings: false, wasm: false } });
  const action = new vm.Script(transformed, { filename: 'run.js' }).runInContext(context, { timeout: 1_000 });
  if (typeof action !== 'function') throw new Error('The default export in run.js must be a function.');
  await action({ workspace, run, input: Object.freeze({ ...(workerData.input || {}) }), pdf, csv, zip });
  parentPort.postMessage({ ok: true, kind: 'script', status: 'completed', logs });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error), logs });
}
