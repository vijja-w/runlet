import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.RUNLET_STATE_DIR ? path.resolve(process.env.RUNLET_STATE_DIR) : path.join(appRoot, '.runlet');
const statePath = path.join(stateDir, 'state.json');
const legacyStatePath = path.join(appRoot, '.workshop', 'state.json');
const workerPath = path.join(appRoot, 'src', 'action-worker.mjs');

function normalizeState(state) {
  const usedNames = new Set();
  const workspaces = (Array.isArray(state?.workspaces) ? state.workspaces : []).map((workspace) => {
    const baseName = String(workspace.name || path.basename(workspace.path) || 'Workspace').trim() || 'Workspace';
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) name = `${baseName} (${suffix++})`;
    usedNames.add(name.toLowerCase());
    return { ...workspace, name };
  });
  const orders = state?.orders && typeof state.orders === 'object' && !Array.isArray(state.orders) ? state.orders : {};
  return { selectedId: state?.selectedId || null, ...state, workspaces, orders };
}

async function loadState() {
  try { return normalizeState(JSON.parse(await fs.readFile(statePath, 'utf8'))); }
  catch {
    try { return normalizeState(JSON.parse(await fs.readFile(legacyStatePath, 'utf8'))); }
    catch { return { selectedId: null, workspaces: [], orders: {} }; }
  }
}

async function saveState(state) {
  await fs.mkdir(stateDir, { recursive: true });
  const temporary = `${statePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2));
  await fs.rename(temporary, statePath);
}

function slugify(value) {
  return String(value || 'workspace').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
}

function actionSlug(value) {
  const slug = slugify(value);
  if (slug !== value) throw new Error('Action slug must use lower-case letters, numbers, and hyphens.');
  return slug;
}

async function listRelativeFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function uniqueId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export async function listWorkspaces() {
  const state = await loadState();
  return { ...state, workspaces: await Promise.all(state.workspaces.map(async (workspace) => ({ ...workspace, available: await fs.access(workspace.path).then(() => true).catch(() => false) }))) };
}

export async function createWorkspace({ name, folderPath, create = false }) {
  const state = await loadState();
  const workspaceName = String(name || '').trim();
  if (!workspaceName) throw new Error('Workspace name is required.');
  if (state.workspaces.some((workspace) => workspace.name.trim().toLowerCase() === workspaceName.toLowerCase())) {
    throw new Error('Workspace names must be unique.');
  }
  const resolved = folderPath ? path.resolve(folderPath.replace(/^~(?=$|\/)/, os.homedir())) : path.join(os.homedir(), 'Runlet Workspaces', slugify(workspaceName));
  const exists = await fs.stat(resolved).then((stat) => stat.isDirectory()).catch(() => false);
  if (!exists && !create) throw new Error('That folder does not exist. Choose an existing folder.');
  if (!exists) await fs.mkdir(resolved, { recursive: true });
  if (state.workspaces.some((workspace) => workspace.path === resolved)) throw new Error('That folder is already a workspace.');
  await fs.mkdir(path.join(resolved, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(resolved, 'prompts'), { recursive: true });
  const workspaceFile = path.join(resolved, 'workspace.md');
  if (!(await fs.access(workspaceFile).then(() => true).catch(() => false))) await fs.writeFile(workspaceFile, `# ${workspaceName}\n\nManaged by Runlet.\n`);
  const workspace = { id: uniqueId(), name: workspaceName, path: resolved, createdAt: new Date().toISOString() };
  state.workspaces.push(workspace);
  state.selectedId = workspace.id;
  await saveState(state);
  return workspace;
}

export async function updateWorkspace(id, { name }) {
  const state = await loadState();
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) throw new Error('Workspace not found.');
  const workspaceName = String(name || '').trim();
  if (!workspaceName) throw new Error('Workspace name is required.');
  if (state.workspaces.some((item) => item.id !== id && item.name.trim().toLowerCase() === workspaceName.toLowerCase())) {
    throw new Error('Workspace names must be unique.');
  }
  workspace.name = workspaceName;
  await saveState(state);
  return workspace;
}

export async function selectWorkspace(id) {
  const state = await loadState();
  if (!state.workspaces.some((workspace) => workspace.id === id)) throw new Error('Workspace not found.');
  state.selectedId = id;
  await saveState(state);
  return getWorkspace(id);
}

export async function getCurrentWorkspace() {
  const workspace = await getWorkspace();
  return { ...workspace, available: await fs.access(workspace.path).then(() => true).catch(() => false) };
}

export async function getWorkspace(id) {
  const state = await loadState();
  const workspace = state.workspaces.find((item) => item.id === (id || state.selectedId));
  if (!workspace) throw new Error('No workspace is selected.');
  return workspace;
}

export async function removeWorkspace(id) {
  const state = await loadState();
  const removed = state.workspaces.find((workspace) => workspace.id === id);
  if (!removed) throw new Error('Workspace not found.');
  state.workspaces = state.workspaces.filter((workspace) => workspace.id !== id);
  delete state.orders?.[id];
  if (state.selectedId === id) state.selectedId = state.workspaces[0]?.id || null;
  await saveState(state);
  return { removed: { id: removed.id, name: removed.name, path: removed.path }, selectedId: state.selectedId };
}

function applySavedOrder(items, order = []) {
  const itemsBySlug = new Map(items.map((item) => [item.slug, item]));
  const ordered = [];
  for (const slug of Array.isArray(order) ? order : []) {
    const item = itemsBySlug.get(slug);
    if (!item) continue;
    ordered.push(item);
    itemsBySlug.delete(slug);
  }
  return [...ordered, ...[...itemsBySlug.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

async function removeFromSavedOrder(workspaceId, kind, slug) {
  const state = await loadState();
  const order = state.orders?.[workspaceId]?.[kind];
  if (!Array.isArray(order) || !order.includes(slug)) return;
  state.orders[workspaceId][kind] = order.filter((item) => item !== slug);
  await saveState(state);
}

export function resolveInside(workspacePath, relativePath = '.') {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, String(relativePath).replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Path must stay inside the workspace.');
  return target;
}

function parseReadme(markdown, fallbackName) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackName;
  const withoutTitle = markdown.replace(/^#\s+.+$/m, '').trim();
  const description = withoutTitle.split(/\n\s*\n/).find((part) => !part.trim().startsWith('#'))?.replace(/[*_`]/g, '').trim() || 'A reusable workspace Action.';
  const howBlock = markdown.match(/##\s+How to use\s*\n([\s\S]*?)(?=\n##\s|$)/i)?.[1] || '';
  const steps = [...howBlock.matchAll(/^\s*\d+\.\s+(.+)$/gm)].map((match) => match[1].replace(/\*\*/g, '').trim());
  return { title, description, steps, markdown };
}

async function readMetadata(directory, fallback) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(directory, 'runlet.json'), 'utf8'));
    return {
      ...fallback,
      ...value,
      interface: { ...(fallback.interface || {}), ...(value.interface || {}) },
    };
  } catch {
    return fallback;
  }
}

async function writeMetadata(directory, metadata) {
  await fs.writeFile(path.join(directory, 'runlet.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

async function hydrateControls(workspacePath, controls = []) {
  return Promise.all(controls.map(async (control) => {
    const hydrated = { ...control };
    if (control.type === 'select' && control.source?.type === 'csv-column') {
      const sourcePath = resolveInside(workspacePath, control.source.path);
      const rows = parseCsv(await fs.readFile(sourcePath, 'utf8'));
      const columnIndex = rows[0]?.indexOf(control.source.column) ?? -1;
      if (columnIndex < 0) throw new Error(`Column “${control.source.column}” was not found in ${control.source.path}.`);
      hydrated.options = [...new Set(rows.slice(1).map((row) => row[columnIndex]).filter(Boolean))];
    }
    hydrated.options = Array.isArray(hydrated.options) ? hydrated.options.map(String) : [];
    return hydrated;
  }));
}

export async function listActions(workspaceId) {
  const workspace = await getWorkspace(workspaceId);
  const actionsRoot = resolveInside(workspace.path, 'actions');
  await fs.mkdir(actionsRoot, { recursive: true });
  const entries = await fs.readdir(actionsRoot, { withFileTypes: true });
  const actions = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(actionsRoot, entry.name);
    if (!(await fs.access(path.join(directory, 'run.js')).then(() => true).catch(() => false))) continue;
    const readme = await fs.readFile(path.join(directory, 'README.md'), 'utf8').catch(() => `# ${entry.name}\n\nA reusable workspace Action.`);
    const info = parseReadme(readme, entry.name);
    const kind = await fs.access(path.join(directory, 'PROMPT.md')).then(() => 'ai').catch(() => 'script');
    const outputs = await listRelativeFiles(path.join(directory, 'outputs'));
    const inputs = await listRelativeFiles(path.join(directory, 'inputs'));
    actions.push({ slug: entry.name, name: info.title, description: info.description, steps: info.steps, readme: info.markdown, kind, inputs, hasView: await fs.access(path.join(directory, 'index.html')).then(() => true).catch(() => false), outputs });
  }
  return actions.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAction(workspaceId, slug) {
  const actions = await listActions(workspaceId);
  const action = actions.find((item) => item.slug === slug);
  if (!action) throw new Error('Action not found.');
  if (action.kind === 'ai') {
    const workspace = await getWorkspace(workspaceId);
    action.prompt = await fs.readFile(resolveInside(workspace.path, path.join('actions', slug, 'PROMPT.md')), 'utf8');
  }
  return action;
}

export async function runAction(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  const action = await getAction(workspace.id, slug);
  if (action.kind === 'ai') {
    return {
      ok: true,
      kind: 'ai',
      status: 'instructions_ready',
      workspace: { id: workspace.id, name: workspace.name },
      action: { slug: action.slug, name: action.name },
      prompt: action.prompt,
      inputFiles: action.inputs.map((name) => path.join('actions', slug, 'inputs', name)),
      outputDirectory: path.join('actions', slug, 'outputs'),
      nextStep: 'Carry out the prompt using only this registered workspace. Read inputs through Runlet, write generated files only beneath outputDirectory, inspect them, then call finish_ai_action.',
    };
  }
  const actionDir = resolveInside(workspace.path, path.join('actions', slug));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { workspacePath: workspace.path, actionDir }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Action exceeded the 30 second time limit.')); }, 30_000);
    worker.once('message', (message) => { clearTimeout(timer); message.ok ? resolve(message) : reject(new Error(message.error)); });
    worker.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function finishAiAction(workspaceId, slug, summary = '') {
  const workspace = await getWorkspace(workspaceId);
  const action = await getAction(workspace.id, slug);
  if (action.kind !== 'ai') throw new Error('This is not an AI Action.');
  const outputs = await listRelativeFiles(resolveInside(workspace.path, path.join('actions', slug, 'outputs')));
  if (!outputs.length) throw new Error('The AI Action has no outputs yet.');
  return { ok: true, kind: 'ai', status: 'completed', action: { slug, name: action.name }, outputs, summary: String(summary || '') };
}

export function getActionTemplate(kind = 'script', withView = false) {
  if (!['script', 'ai'].includes(kind)) throw new Error('Action kind must be “script” or “ai”.');
  const shared = {
    structure: ['README.md', 'run.js', 'inputs/', 'outputs/', ...(withView ? ['index.html'] : [])],
    rules: [
      'Use a lower-case kebab-case folder name beneath actions/.',
      'Keep README.md as short, plain-language usage documentation. The normal browser interface is generated from runlet.json.',
      'Read source files from inputs/ or another explicitly named workspace path.',
      'Write every generated file beneath this Action’s outputs/ directory.',
      'Add index.html only when an interactive page materially helps; it must read relative files from outputs/.',
    ],
  };
  if (kind === 'ai') return {
    kind,
    ...shared,
    structure: ['README.md', 'run.js', 'PROMPT.md', 'inputs/', 'outputs/', ...(withView ? ['index.html'] : [])],
    runJs: "export default async function ({ run }) {\n  run.log('This AI Action is performed by the connected assistant.');\n}\n",
    promptGuidance: 'PROMPT.md must state the exact inputs to read, fields or transformation required, exact output paths and formats, and the boundary that generated files belong only in outputs/.',
  };
  return {
    kind,
    ...shared,
    runJsGuidance: 'run.js must export one default async function receiving { workspace, run, pdf, csv, zip }. Use only workspace.read/readBytes/write/writeBytes/list/exists/mkdir/delete/fetch, pdf.extractText, csv.parse/stringify, zip.extract/create, and run.log. Do not import modules or access paths outside the registered workspace.',
  };
}

export async function listScripts(workspaceId) {
  const workspace = await getWorkspace(workspaceId);
  const state = await loadState();
  const scriptsRoot = resolveInside(workspace.path, 'scripts');
  await fs.mkdir(scriptsRoot, { recursive: true });
  const entries = await fs.readdir(scriptsRoot, { withFileTypes: true });
  const scripts = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(scriptsRoot, entry.name);
    if (!(await fs.access(path.join(directory, 'run.js')).then(() => true).catch(() => false))) continue;
    const readme = await fs.readFile(path.join(directory, 'README.md'), 'utf8').catch(() => `# ${entry.name}\n\nA reusable Script.`);
    const info = parseReadme(readme, entry.name);
    const metadata = await readMetadata(directory, { name: info.title, description: info.description, interface: { controls: [], results: [] } });
    scripts.push({
      slug: entry.name,
      name: metadata.name,
      description: metadata.description,
      steps: info.steps,
      readme: info.markdown,
      inputs: await listRelativeFiles(path.join(directory, 'inputs')),
      outputs: await listRelativeFiles(path.join(directory, 'outputs')),
      hasView: await fs.access(path.join(directory, 'index.html')).then(() => true).catch(() => false),
      controls: await hydrateControls(workspace.path, metadata.interface?.controls || []),
      results: Array.isArray(metadata.interface?.results) ? metadata.interface.results : [],
    });
  }
  return applySavedOrder(scripts, state.orders?.[workspace.id]?.scripts);
}

export async function getScript(workspaceId, slug) {
  const scripts = await listScripts(workspaceId);
  const script = scripts.find((item) => item.slug === slug);
  if (!script) throw new Error('Script not found.');
  return script;
}

export function getScriptTemplate(withView = false) {
  return {
    structure: ['runlet.json', 'README.md', 'run.js', 'inputs/', 'outputs/', ...(withView ? ['index.html'] : [])],
    rules: [
      'Use a lower-case kebab-case folder name beneath scripts/.',
      'Store the editable display name, description, controls, and result panels in runlet.json.',
      'Treat README.md as the plain-language user interface.',
      'run.js receives { workspace, run, input, pdf, csv, zip }. Use input values declared by the controls.',
      'Controls may be text, number, or select. A select may load unique values from a workspace CSV column.',
      'Results may display an outputs/ text file as a summary or an outputs/ CSV file as a table.',
      'Use only workspace.read/readBytes/write/writeBytes/list/exists/mkdir/delete/fetch, pdf.extractText, csv.parse/stringify, zip.extract/create, and run.log.',
      'Write every generated file beneath this Script’s outputs/ directory.',
      'Runlet generates the normal interactive interface. Add index.html only for a specialized dashboard.',
    ],
    manifestExample: {
      name: 'Current Recipe Cost',
      description: 'Calculate a recipe using the latest invoice prices.',
      interface: {
        controls: [{ name: 'recipe', label: 'Recipe', type: 'select', required: true, source: { type: 'csv-column', path: 'recipes.csv', column: 'recipe' } }],
        results: [{ type: 'summary', label: 'Summary', path: 'outputs/summary.txt' }, { type: 'table', label: 'Details', path: 'outputs/results.csv' }],
      },
    },
  };
}

export async function createScript({ workspaceId, slug, name, description, controls = [], results = [], readme, runJs, indexHtml, overwrite = false }) {
  const workspace = await getWorkspace(workspaceId);
  const safeSlug = actionSlug(slug);
  if (!String(readme || '').trim().startsWith('# ')) throw new Error('README.md must begin with a level-one title.');
  if (!/export\s+default/.test(String(runJs || ''))) throw new Error('run.js must export one default function.');
  const directory = resolveInside(workspace.path, path.join('scripts', safeSlug));
  const exists = await fs.access(directory).then(() => true).catch(() => false);
  if (exists && !overwrite) throw new Error('That Script already exists.');
  await fs.mkdir(path.join(directory, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(directory, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(directory, 'README.md'), String(readme));
  await fs.writeFile(path.join(directory, 'run.js'), String(runJs));
  const info = parseReadme(String(readme), safeSlug);
  await writeMetadata(directory, {
    name: String(name || info.title),
    description: String(description || info.description),
    interface: { controls: Array.isArray(controls) ? controls : [], results: Array.isArray(results) ? results : [] },
  });
  if (indexHtml !== undefined) await fs.writeFile(path.join(directory, 'index.html'), String(indexHtml));
  return getScript(workspace.id, safeSlug);
}

export async function updateScriptMetadata(workspaceId, slug, { name, description }) {
  const workspace = await getWorkspace(workspaceId);
  const script = await getScript(workspace.id, slug);
  const directory = resolveInside(workspace.path, path.join('scripts', slug));
  const metadata = await readMetadata(directory, { name: script.name, description: script.description, interface: { controls: script.controls, results: script.results } });
  metadata.name = String(name ?? metadata.name).trim();
  metadata.description = String(description ?? metadata.description).trim();
  if (!metadata.name) throw new Error('Name cannot be empty.');
  if (!metadata.description) throw new Error('Description cannot be empty.');
  await writeMetadata(directory, metadata);
  return getScript(workspace.id, slug);
}

export async function deleteScript(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  const script = await getScript(workspace.id, slug);
  await fs.rm(resolveInside(workspace.path, path.join('scripts', slug)), { recursive: true });
  await removeFromSavedOrder(workspace.id, 'scripts', slug);
  return { deleted: { slug: script.slug, name: script.name } };
}

export async function runScript(workspaceId, slug, input = {}) {
  const workspace = await getWorkspace(workspaceId);
  const script = await getScript(workspace.id, slug);
  const values = {};
  for (const control of script.controls) {
    let value = input?.[control.name] ?? control.default ?? '';
    if (control.type === 'number' && value !== '') {
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error(`${control.label || control.name} must be a number.`);
    }
    if (control.required && (value === '' || value === null || value === undefined)) throw new Error(`${control.label || control.name} is required.`);
    if (control.type === 'select' && value !== '' && !control.options.includes(String(value))) throw new Error(`${control.label || control.name} is not a valid option.`);
    values[control.name] = value;
  }
  const scriptDir = resolveInside(workspace.path, path.join('scripts', slug));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { workspacePath: workspace.path, actionDir: scriptDir, input: values }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Script exceeded the 30 second time limit.')); }, 30_000);
    worker.once('message', (message) => { clearTimeout(timer); message.ok ? resolve(message) : reject(new Error(message.error)); });
    worker.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function getScriptResults(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  const script = await getScript(workspace.id, slug);
  const scriptRoot = resolveInside(workspace.path, path.join('scripts', slug));
  return Promise.all(script.results.map(async (result) => {
    const relative = String(result.path || '').replace(/^[/\\]+/, '');
    if (!relative.startsWith('outputs/')) throw new Error('Script result paths must be beneath outputs/.');
    const target = resolveInside(scriptRoot, relative);
    const content = await fs.readFile(target, 'utf8').catch(() => null);
    if (content === null) return { ...result, missing: true };
    if (result.type === 'table') {
      const rows = parseCsv(content);
      return { ...result, columns: rows[0] || [], rows: rows.slice(1) };
    }
    return { ...result, content };
  }));
}

export async function writeScriptInput(workspaceId, slug, name, data) {
  const workspace = await getWorkspace(workspaceId);
  await getScript(workspace.id, slug);
  const safeName = path.basename(String(name || ''));
  if (!safeName || safeName !== name) throw new Error('Input filename must not contain folders.');
  const target = resolveInside(workspace.path, path.join('scripts', slug, 'inputs', safeName));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { path: path.join('scripts', slug, 'inputs', safeName) };
}

export async function readScriptInput(workspaceId, slug, name) {
  const workspace = await getWorkspace(workspaceId);
  const script = await getScript(workspace.id, slug);
  const safeName = String(name || '').replace(/^[/\\]+/, '');
  if (!script.inputs.includes(safeName)) throw new Error('Script input not found.');
  return { data: await fs.readFile(resolveInside(workspace.path, path.join('scripts', slug, 'inputs', safeName))), path: path.join('scripts', slug, 'inputs', safeName) };
}

export async function writeScriptOutput(workspaceId, slug, name, data) {
  const workspace = await getWorkspace(workspaceId);
  await getScript(workspace.id, slug);
  const safeName = String(name || '').replace(/^[/\\]+/, '');
  if (!safeName || safeName.split(/[\\/]/).includes('..')) throw new Error('Output path must stay inside the Script outputs folder.');
  const outputRoot = resolveInside(workspace.path, path.join('scripts', slug, 'outputs'));
  const target = resolveInside(outputRoot, safeName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { path: path.join('scripts', slug, 'outputs', safeName) };
}

export async function listPrompts(workspaceId) {
  const workspace = await getWorkspace(workspaceId);
  const state = await loadState();
  const promptsRoot = resolveInside(workspace.path, 'prompts');
  await fs.mkdir(promptsRoot, { recursive: true });
  const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
  const prompts = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(promptsRoot, entry.name);
    const promptPath = path.join(directory, 'PROMPT.md');
    const content = await fs.readFile(promptPath, 'utf8').catch(() => null);
    if (content === null) continue;
    const info = parseReadme(content, entry.name);
    const metadata = await readMetadata(directory, { name: info.title, description: info.description });
    prompts.push({ slug: entry.name, name: metadata.name, description: metadata.description, content });
  }
  return applySavedOrder(prompts, state.orders?.[workspace.id]?.prompts);
}

export async function reorderItems(workspaceId, kind, slugs) {
  if (!['scripts', 'prompts'].includes(kind)) throw new Error('Only Scripts and Prompts can be reordered.');
  const workspace = await getWorkspace(workspaceId);
  const items = kind === 'scripts' ? await listScripts(workspace.id) : await listPrompts(workspace.id);
  const requested = Array.isArray(slugs) ? slugs.map(String) : [];
  const existing = new Set(items.map((item) => item.slug));
  if (requested.length !== existing.size || new Set(requested).size !== requested.length || requested.some((slug) => !existing.has(slug))) {
    throw new Error(`The ${kind} list changed. Refresh and try again.`);
  }
  const state = await loadState();
  state.orders ||= {};
  state.orders[workspace.id] = { ...(state.orders[workspace.id] || {}), [kind]: requested };
  await saveState(state);
  return kind === 'scripts' ? listScripts(workspace.id) : listPrompts(workspace.id);
}

export async function getPrompt(workspaceId, slug) {
  const prompts = await listPrompts(workspaceId);
  const prompt = prompts.find((item) => item.slug === slug);
  if (!prompt) throw new Error('Prompt not found.');
  return prompt;
}

export function getPromptTemplate() {
  return {
    structure: ['runlet.json', 'PROMPT.md'],
    rules: [
      'Use a lower-case kebab-case folder name beneath prompts/.',
      'Store the editable display name and description in runlet.json.',
      'Begin PROMPT.md with clear provider-neutral instructions.',
      'Write provider-neutral instructions that can use files attached directly to the AI conversation.',
      'Name required inputs, the exact work to perform, and the expected output format or filename.',
    ],
  };
}

export async function createPrompt({ workspaceId, slug, name, description, content, overwrite = false }) {
  const workspace = await getWorkspace(workspaceId);
  const safeSlug = actionSlug(slug);
  if (!String(content || '').trim().startsWith('# ')) throw new Error('PROMPT.md must begin with a level-one title.');
  const directory = resolveInside(workspace.path, path.join('prompts', safeSlug));
  const exists = await fs.access(directory).then(() => true).catch(() => false);
  if (exists && !overwrite) throw new Error('That Prompt already exists.');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'PROMPT.md'), String(content));
  const info = parseReadme(String(content), safeSlug);
  await writeMetadata(directory, { name: String(name || info.title), description: String(description || info.description) });
  return getPrompt(workspace.id, safeSlug);
}

export async function updatePromptMetadata(workspaceId, slug, { name, description }) {
  const workspace = await getWorkspace(workspaceId);
  const prompt = await getPrompt(workspace.id, slug);
  const directory = resolveInside(workspace.path, path.join('prompts', slug));
  const metadata = await readMetadata(directory, { name: prompt.name, description: prompt.description });
  metadata.name = String(name ?? metadata.name).trim();
  metadata.description = String(description ?? metadata.description).trim();
  if (!metadata.name) throw new Error('Name cannot be empty.');
  if (!metadata.description) throw new Error('Description cannot be empty.');
  await writeMetadata(directory, metadata);
  return getPrompt(workspace.id, slug);
}

export async function updatePrompt(workspaceId, slug, content) {
  const workspace = await getWorkspace(workspaceId);
  await getPrompt(workspace.id, slug);
  if (!String(content || '').trim().startsWith('# ')) throw new Error('PROMPT.md must begin with a level-one title.');
  await fs.writeFile(resolveInside(workspace.path, path.join('prompts', slug, 'PROMPT.md')), String(content));
  return getPrompt(workspace.id, slug);
}

export async function deletePrompt(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  const prompt = await getPrompt(workspace.id, slug);
  await fs.rm(resolveInside(workspace.path, path.join('prompts', slug)), { recursive: true });
  await removeFromSavedOrder(workspace.id, 'prompts', slug);
  return { deleted: { slug: prompt.slug, name: prompt.name } };
}

export async function createAction({ workspaceId, slug, readme, runJs, prompt, indexHtml, overwrite = false }) {
  const workspace = await getWorkspace(workspaceId);
  const safeSlug = actionSlug(slug);
  if (!String(readme || '').trim().startsWith('# ')) throw new Error('README.md must begin with a level-one title.');
  if (!/export\s+default/.test(String(runJs || ''))) throw new Error('run.js must export one default function.');
  const directory = resolveInside(workspace.path, path.join('actions', safeSlug));
  const exists = await fs.access(directory).then(() => true).catch(() => false);
  if (exists && !overwrite) throw new Error('That Action already exists. Set overwrite only when the user explicitly asked to replace it.');
  await fs.mkdir(path.join(directory, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(directory, 'outputs'), { recursive: true });
  await fs.writeFile(path.join(directory, 'README.md'), String(readme));
  await fs.writeFile(path.join(directory, 'run.js'), String(runJs));
  if (prompt !== undefined) {
    if (!String(prompt).trim()) throw new Error('PROMPT.md cannot be empty.');
    await fs.writeFile(path.join(directory, 'PROMPT.md'), String(prompt));
  } else if (overwrite) {
    await fs.rm(path.join(directory, 'PROMPT.md'), { force: true });
  }
  if (indexHtml !== undefined) await fs.writeFile(path.join(directory, 'index.html'), String(indexHtml));
  return getAction(workspace.id, safeSlug);
}

export async function renameAction(workspaceId, slug, newSlug) {
  const workspace = await getWorkspace(workspaceId);
  await getAction(workspace.id, slug);
  const safeNewSlug = actionSlug(newSlug);
  const source = resolveInside(workspace.path, path.join('actions', slug));
  const target = resolveInside(workspace.path, path.join('actions', safeNewSlug));
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error('An Action with that name already exists.');
  await fs.rename(source, target);
  return getAction(workspace.id, safeNewSlug);
}

export async function duplicateAction(workspaceId, slug, newSlug) {
  const workspace = await getWorkspace(workspaceId);
  await getAction(workspace.id, slug);
  const safeNewSlug = actionSlug(newSlug);
  const source = resolveInside(workspace.path, path.join('actions', slug));
  const target = resolveInside(workspace.path, path.join('actions', safeNewSlug));
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error('An Action with that name already exists.');
  await fs.cp(source, target, { recursive: true });
  return getAction(workspace.id, safeNewSlug);
}

export async function deleteAction(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  const action = await getAction(workspace.id, slug);
  await fs.rm(resolveInside(workspace.path, path.join('actions', slug)), { recursive: true });
  return { deleted: { slug: action.slug, name: action.name } };
}

export async function writeActionInput(workspaceId, slug, name, data) {
  const workspace = await getWorkspace(workspaceId);
  await getAction(workspace.id, slug);
  const safeName = path.basename(String(name || ''));
  if (!safeName || safeName !== name) throw new Error('Input filename must not contain folders.');
  const target = resolveInside(workspace.path, path.join('actions', slug, 'inputs', safeName));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { path: path.join('actions', slug, 'inputs', safeName) };
}

export async function writeActionOutput(workspaceId, slug, name, data) {
  const workspace = await getWorkspace(workspaceId);
  await getAction(workspace.id, slug);
  const safeName = String(name || '').replace(/^[/\\]+/, '');
  if (!safeName || safeName.split(path.sep).includes('..')) throw new Error('Output path must stay inside the Action outputs folder.');
  const outputRoot = resolveInside(workspace.path, path.join('actions', slug, 'outputs'));
  const target = resolveInside(outputRoot, safeName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { path: path.join('actions', slug, 'outputs', safeName) };
}

export async function readActionInput(workspaceId, slug, name) {
  const workspace = await getWorkspace(workspaceId);
  const action = await getAction(workspace.id, slug);
  const safeName = String(name || '').replace(/^[/\\]+/, '');
  if (!action.inputs.includes(safeName)) throw new Error('Action input not found.');
  const data = await fs.readFile(resolveInside(workspace.path, path.join('actions', slug, 'inputs', safeName)));
  return { data, path: path.join('actions', slug, 'inputs', safeName) };
}

export async function listFiles(workspaceId, relativePath = '.') {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => !['.git', 'node_modules', '.DS_Store'].includes(entry.name)).map(async (entry) => {
    const itemPath = path.join(directory, entry.name);
    const stat = await fs.stat(itemPath);
    return { name: entry.name, path: path.relative(workspace.path, itemPath) || '.', type: entry.isDirectory() ? 'directory' : 'file', size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }));
}

export async function readFile(workspaceId, relativePath) { const workspace = await getWorkspace(workspaceId); return fs.readFile(resolveInside(workspace.path, relativePath), 'utf8'); }
export async function writeFile(workspaceId, relativePath, content) { const workspace = await getWorkspace(workspaceId); const target = resolveInside(workspace.path, relativePath); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); return { path: relativePath }; }
export async function makeDirectory(workspaceId, relativePath) { const workspace = await getWorkspace(workspaceId); await fs.mkdir(resolveInside(workspace.path, relativePath), { recursive: true }); return { path: relativePath }; }
export async function moveFile(workspaceId, from, to) { const workspace = await getWorkspace(workspaceId); const target = resolveInside(workspace.path, to); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(resolveInside(workspace.path, from), target); return { path: to }; }
export async function deleteFile(workspaceId, relativePath) { const workspace = await getWorkspace(workspaceId); const target = resolveInside(workspace.path, relativePath); if (target === path.resolve(workspace.path)) throw new Error('Cannot delete a workspace root.'); await fs.rm(target, { recursive: true }); }

export async function listDirectories(folderPath = os.homedir()) {
  const resolved = path.resolve(String(folderPath).replace(/^~(?=$|\/)/, os.homedir()));
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return { path: resolved, parent: path.dirname(resolved), directories: entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) })).sort((a, b) => a.name.localeCompare(b.name)) };
}
