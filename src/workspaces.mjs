import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  addDataRow as addWorkspaceDataRow,
  addDataColumn as addWorkspaceDataColumn,
  createDataTable as createWorkspaceDataTable,
  deleteDataColumn as deleteWorkspaceDataColumn,
  deleteDataRow as deleteWorkspaceDataRow,
  deleteInboxTables,
  ensureInboxTable,
  ensureWorkspaceDatabase,
  getDataTable as readWorkspaceDataTable,
  getDistinctValues,
  listDataTables as readWorkspaceDataTables,
  moveDataColumn as moveWorkspaceDataColumn,
  renameDataColumn as renameWorkspaceDataColumn,
  updateDataCell as updateWorkspaceDataCell,
  writeDataRows as writeWorkspaceDataRows,
} from './database.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.RUNLET_STATE_DIR ? path.resolve(process.env.RUNLET_STATE_DIR) : path.join(appRoot, '.runlet');
const statePath = path.join(stateDir, 'state.json');
const legacyStatePath = path.join(appRoot, '.workshop', 'state.json');
const workerPath = path.join(appRoot, 'src', 'action-worker.mjs');
const runHistoryLimit = 50;
const runHistoryEntryLimit = 64_000;
const runHistoryWrites = new Map();
const inboxDefaults = Object.freeze({
  kind: 'inbox',
  version: 2,
  enabled: true,
  instructions: 'INSTRUCTIONS.md',
  processed: 'processed',
  needsReview: 'needs-review',
});

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

function truncate(value, limit) {
  const text = String(value || '');
  return text.length <= limit ? text : `${text.slice(0, limit - 14)}\n…truncated…`;
}

function boundedLogs(logs) {
  const kept = [];
  let remaining = runHistoryEntryLimit;
  for (const value of Array.isArray(logs) ? logs : []) {
    if (remaining <= 0) break;
    const line = truncate(value, remaining);
    kept.push(line);
    remaining -= line.length;
  }
  return kept;
}

function runHistoryPath(scriptDirectory) {
  return path.join(scriptDirectory, '.runlet', 'runs.jsonl');
}

async function appendScriptRun(scriptDirectory, entry) {
  const previous = runHistoryWrites.get(scriptDirectory) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const target = runHistoryPath(scriptDirectory);
    const history = (await fs.readFile(target, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    history.push(entry);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${history.slice(-runHistoryLimit).map((run) => JSON.stringify(run)).join('\n')}\n`);
  });
  runHistoryWrites.set(scriptDirectory, next);
  try { await next; }
  finally { if (runHistoryWrites.get(scriptDirectory) === next) runHistoryWrites.delete(scriptDirectory); }
}

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
  await ensureWorkspaceDatabase(resolved);
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

function inboxName(value, fallback) {
  const name = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (name === '.' || name === '..' || path.basename(name) !== name || /[/\\]/.test(name)) throw new Error('Inbox settings contain an invalid filename.');
  return name;
}

function normalizeInboxConfig(value) {
  if (!value || value.kind !== 'inbox') return null;
  return {
    kind: 'inbox',
    version: 2,
    enabled: value.enabled !== false,
    instructions: inboxName(value.instructions, inboxDefaults.instructions),
    table: typeof value.table === 'string' && value.table.trim() ? value.table.trim() : null,
    legacyData: value.data ? inboxName(value.data, 'data.csv') : null,
    processed: inboxName(value.processed, inboxDefaults.processed),
    needsReview: inboxName(value.needsReview, inboxDefaults.needsReview),
  };
}

async function readInboxManifest(directory) {
  const target = path.join(directory, 'runlet.json');
  let source;
  try { source = await fs.readFile(target, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, config: null };
    throw error;
  }
  try {
    const config = normalizeInboxConfig(JSON.parse(source));
    return config
      ? { exists: true, config }
      : { exists: true, config: null, reason: 'This folder already uses runlet.json for another Runlet item.' };
  } catch (error) {
    return { exists: true, config: null, reason: error instanceof SyntaxError ? 'This folder has an unreadable runlet.json file.' : error.message };
  }
}

async function writeInboxManifest(directory, config, { replace = true } = {}) {
  const target = path.join(directory, 'runlet.json');
  const stored = {
    kind: 'inbox',
    version: 2,
    enabled: config.enabled !== false,
    instructions: config.instructions,
    processed: config.processed,
    needsReview: config.needsReview,
    ...(config.table ? { table: config.table } : {}),
  };
  const source = `${JSON.stringify(stored, null, 2)}\n`;
  if (!replace) {
    await fs.writeFile(target, source, { flag: 'wx' });
    return;
  }
  const temporary = `${target}.tmp-${uniqueId()}`;
  await fs.writeFile(temporary, source);
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

async function inboxProtectionReason(workspaceRoot, relativePath) {
  const relative = path.relative(workspaceRoot, resolveInside(workspaceRoot, relativePath));
  if (!relative) return 'The workspace folder cannot become an Inbox.';
  const parts = relative.split(path.sep);
  if (parts[0] === 'scripts' || parts[0] === 'prompts') return 'Runlet Scripts and Prompts cannot become Inboxes.';
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = path.join(workspaceRoot, ...parts.slice(0, index));
    const manifest = await readInboxManifest(ancestor);
    if (!manifest.config) continue;
    if ([manifest.config.processed, manifest.config.needsReview].includes(parts[index])) return 'Inbox result folders cannot become Inboxes.';
  }
  return null;
}

async function inboxIssues(directory, config) {
  const expected = [
    [config.instructions, 'file'],
    [config.processed, 'directory'],
    [config.needsReview, 'directory'],
  ];
  const issues = [];
  for (const [name, expectedType] of expected) {
    const stat = await fs.stat(path.join(directory, name)).catch(() => null);
    if (!stat) issues.push({ name, type: 'missing', reason: `${name} is missing.` });
    else if (expectedType === 'file' ? !stat.isFile() : !stat.isDirectory()) issues.push({ name, type: 'conflict', reason: `${name} is not a ${expectedType === 'file' ? 'file' : 'folder'}.` });
  }
  return issues;
}

async function ensureInboxData(workspace, relativePath, directory, config) {
  const legacyCsvPath = config.legacyData
    ? path.join(directory, config.legacyData)
    : null;
  const hasLegacyCsv = legacyCsvPath ? await fs.stat(legacyCsvPath).then((stat) => stat.isFile()).catch(() => false) : false;
  const table = await ensureInboxTable(workspace.path, relativePath, {
    displayName: path.basename(directory),
    legacyCsvPath: hasLegacyCsv ? legacyCsvPath : undefined,
    tableName: config.table,
  });
  if (hasLegacyCsv) {
    const backupDirectory = path.join(workspace.path, '.runlet', 'backups');
    await fs.mkdir(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `${table.table_name}-data-${Date.now()}.csv`);
    await fs.rename(legacyCsvPath, backup);
  }
  if (config.table !== table.table_name || config.legacyData) {
    config.table = table.table_name;
    config.legacyData = null;
    await writeInboxManifest(directory, config);
  }
  return table;
}

async function describeInboxFolder(workspace, relativePath) {
  const directory = resolveInside(workspace.path, relativePath);
  const protection = await inboxProtectionReason(workspace.path, relativePath);
  if (protection) return { canConfigure: false, configured: false, enabled: false, ready: false, status: 'protected', reason: protection, issues: [] };
  const manifest = await readInboxManifest(directory);
  if (!manifest.config) return {
    canConfigure: !manifest.exists,
    configured: false,
    enabled: false,
    ready: false,
    status: manifest.exists ? 'unavailable' : 'off',
    reason: manifest.reason || null,
    issues: [],
  };
  const config = manifest.config;
  const table = await ensureInboxData(workspace, relativePath, directory, config);
  const issues = await inboxIssues(directory, config);
  return {
    canConfigure: true,
    configured: true,
    enabled: config.enabled,
    ready: config.enabled && issues.length === 0,
    status: !config.enabled ? 'off' : issues.length ? 'attention' : 'ready',
    reason: issues[0]?.reason || null,
    issues,
    table: table.table_name,
    rowCount: table.rowCount,
    repairable: issues.length > 0 && issues.every((issue) => issue.type === 'missing'),
    instructionsPath: path.join(relativePath, config.instructions),
    processedPath: path.join(relativePath, config.processed),
    needsReviewPath: path.join(relativePath, config.needsReview),
    instructionsAvailable: !issues.some((issue) => issue.name === config.instructions),
    dataAvailable: true,
  };
}

async function ensureInboxArtifacts(directory, config) {
  const artifacts = [
    [config.instructions, 'file', '# Inbox instructions\n\nDescribe what Runlet should extract from each file and how each row should be recorded in this Inbox’s data table.\n'],
    [config.processed, 'directory'],
    [config.needsReview, 'directory'],
  ];
  const created = [];
  try {
    for (const [name, expectedType, content] of artifacts) {
      const target = path.join(directory, name);
      const stat = await fs.stat(target).catch(() => null);
      if (stat && (expectedType === 'file' ? !stat.isFile() : !stat.isDirectory())) throw new Error(`${name} already exists but is not a ${expectedType === 'file' ? 'file' : 'folder'}.`);
      if (stat) continue;
      if (expectedType === 'file') await fs.writeFile(target, content);
      else await fs.mkdir(target);
      created.push(target);
    }
  } catch (error) {
    await Promise.all(created.reverse().map((target) => fs.rm(target, { recursive: true, force: true })));
    throw error;
  }
  return created;
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
    if (control.type === 'select' && control.source?.type === 'table-column') {
      hydrated.options = await getDistinctValues(workspacePath, control.source.table, control.source.column);
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
    runJsGuidance: 'run.js must export one default async function receiving { workspace, run, data, pdf, csv, zip, xlsx, docx }. Use only workspace.read/readBytes/write/writeBytes/list/exists/mkdir/delete/fetch, data.listTables/read/insert/upsert, pdf.extractText, csv.parse/stringify, zip.extract/create, xlsx.read/create, docx.extractText, and run.log. Do not import modules or access paths outside the registered workspace.',
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
      'run.js receives { workspace, run, input, data, pdf, csv, zip, xlsx, docx }. Use input values declared by the controls.',
      'Controls may be text, number, or select. A select may load unique values from a workspace data-table column.',
      'Results may display an outputs/ text file as a summary or an outputs/ CSV file as a table.',
      'Use only workspace.read/readBytes/write/writeBytes/list/exists/mkdir/delete/fetch, data.listTables/read/insert/upsert, pdf.extractText, csv.parse/stringify, zip.extract/create, xlsx.read/create, docx.extractText, and run.log.',
      'Write every generated file beneath this Script’s outputs/ directory.',
      'Runlet generates the normal interactive interface. Add index.html only for a specialized dashboard.',
    ],
    manifestExample: {
      name: 'Current Recipe Cost',
      description: 'Calculate a recipe using the latest invoice prices.',
      interface: {
        controls: [{ name: 'recipe', label: 'Recipe', type: 'select', required: true, source: { type: 'table-column', table: 'recipes', column: 'recipe' } }],
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
  const scriptDir = resolveInside(workspace.path, path.join('scripts', slug));
  const startedAt = new Date();
  try {
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
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { workspacePath: workspace.path, actionDir: scriptDir, input: values }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Script exceeded the 30 second time limit.')); }, 30_000);
      worker.once('message', (message) => {
        clearTimeout(timer);
        if (message.ok) return resolve(message);
        const error = new Error(message.error || 'Script failed.');
        error.runLogs = message.logs;
        error.runStack = message.stack;
        reject(error);
      });
      worker.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const finishedAt = new Date();
    await appendScriptRun(scriptDir, {
      id: uniqueId(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - startedAt,
      status: 'completed',
      logs: boundedLogs(result.logs),
    }).catch(() => {});
    return result;
  } catch (error) {
    const finishedAt = new Date();
    await appendScriptRun(scriptDir, {
      id: uniqueId(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt - startedAt,
      status: 'failed',
      logs: boundedLogs(error.runLogs),
      error: truncate(error instanceof Error ? error.message : String(error), 8_000),
      details: truncate(error.runStack || (error instanceof Error ? error.stack : ''), 32_000),
    }).catch(() => {});
    throw error;
  }
}

export async function getScriptRunHistory(workspaceId, slug) {
  const workspace = await getWorkspace(workspaceId);
  await getScript(workspace.id, slug);
  const scriptDir = resolveInside(workspace.path, path.join('scripts', slug));
  const history = (await fs.readFile(runHistoryPath(scriptDir), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  return history.slice(-runHistoryLimit).reverse();
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

export async function setupInbox(workspaceId, relativePath, { repair = false } = {}) {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Choose a folder to make an Inbox.');
  const protection = await inboxProtectionReason(workspace.path, relativePath);
  if (protection) throw new Error(protection);
  const manifest = await readInboxManifest(directory);
  if (manifest.exists && !manifest.config) throw new Error(manifest.reason || 'This folder cannot become an Inbox.');

  if (manifest.config) {
    const issues = await inboxIssues(directory, manifest.config);
    if (issues.length && !repair) throw new Error(`Inbox needs attention: ${issues.map((issue) => issue.reason).join(' ')}`);
    if (repair) await ensureInboxArtifacts(directory, manifest.config);
    manifest.config.enabled = true;
    await ensureInboxData(workspace, relativePath, directory, manifest.config);
    await writeInboxManifest(directory, manifest.config);
    return describeInboxFolder(workspace, relativePath);
  }

  const config = { ...inboxDefaults };
  const created = await ensureInboxArtifacts(directory, config);
  try {
    const table = await ensureInboxTable(workspace.path, relativePath, { displayName: path.basename(directory) });
    config.table = table.table_name;
    await writeInboxManifest(directory, config, { replace: false });
  }
  catch (error) {
    await Promise.all(created.reverse().map((target) => fs.rm(target, { recursive: true, force: true })));
    throw error?.code === 'EEXIST' ? new Error('runlet.json was created by another action. Refresh and try again.') : error;
  }
  return describeInboxFolder(workspace, relativePath);
}

export async function setInboxEnabled(workspaceId, relativePath, enabled) {
  if (enabled) return setupInbox(workspaceId, relativePath);
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const manifest = await readInboxManifest(directory);
  if (!manifest.config) throw new Error('This folder is not an Inbox.');
  await ensureInboxData(workspace, relativePath, directory, manifest.config);
  manifest.config.enabled = false;
  await writeInboxManifest(directory, manifest.config);
  return describeInboxFolder(workspace, relativePath);
}

async function inboxPendingFiles(directory, config) {
  const reserved = new Set(['runlet.json', config.instructions, config.legacyData].filter(Boolean));
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.') && !reserved.has(entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function getInbox(workspaceId, relativePath) {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Inbox folder not found.');
  const manifest = await readInboxManifest(directory);
  if (!manifest.config) throw new Error(manifest.reason || 'This folder is not an Inbox.');
  const description = await describeInboxFolder(workspace, relativePath);
  const instructions = description.instructionsAvailable
    ? await fs.readFile(path.join(directory, manifest.config.instructions), 'utf8')
    : null;
  return {
    path: relativePath,
    name: path.basename(directory),
    enabled: description.enabled,
    ready: description.ready,
    status: description.status,
    reason: description.reason,
    issues: description.issues,
    instructionsPath: description.instructionsPath,
    instructions,
    table: description.table,
    rowCount: description.rowCount,
    processedPath: description.processedPath,
    needsReviewPath: description.needsReviewPath,
    pendingFiles: await inboxPendingFiles(directory, manifest.config),
  };
}

export async function updateInboxInstructions(workspaceId, relativePath, content) {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const manifest = await readInboxManifest(directory);
  if (!manifest.config) throw new Error(manifest.reason || 'This folder is not an Inbox.');
  const target = path.join(directory, manifest.config.instructions);
  const stat = await fs.stat(target).catch(() => null);
  if (stat && !stat.isFile()) throw new Error(`${manifest.config.instructions} is not a file.`);
  const temporary = `${target}.tmp-${uniqueId()}`;
  await fs.writeFile(temporary, content);
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  return getInbox(workspace.id, relativePath);
}

export async function listInboxes(workspaceId, { includeDisabled = false } = {}) {
  const workspace = await getWorkspace(workspaceId);
  const inboxes = [];
  async function walk(relativePath = '.', skipNames = new Set()) {
    const directory = resolveInside(workspace.path, relativePath);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules' || skipNames.has(entry.name)) continue;
      if (relativePath === '.' && (entry.name === 'scripts' || entry.name === 'prompts')) continue;
      const childPath = relativePath === '.' ? entry.name : path.join(relativePath, entry.name);
      const childDirectory = path.join(directory, entry.name);
      const manifest = await readInboxManifest(childDirectory);
      if (manifest.config) {
        const description = await describeInboxFolder(workspace, childPath);
        if (includeDisabled || description.enabled) {
          inboxes.push({
            path: childPath,
            name: entry.name,
            enabled: description.enabled,
            ready: description.ready,
            status: description.status,
            reason: description.reason,
            issues: description.issues,
            instructionsPath: description.instructionsPath,
            table: description.table,
            rowCount: description.rowCount,
            processedPath: description.processedPath,
            needsReviewPath: description.needsReviewPath,
            pendingFiles: await inboxPendingFiles(childDirectory, manifest.config),
          });
        }
      }
      const blockedChildren = manifest.config ? new Set([manifest.config.processed, manifest.config.needsReview]) : new Set();
      await walk(childPath, blockedChildren);
    }
  }
  await walk();
  return inboxes.sort((left, right) => left.path.localeCompare(right.path));
}

export async function listDataTables(workspaceId) {
  const workspace = await getWorkspace(workspaceId);
  await listInboxes(workspace.id, { includeDisabled: true });
  return readWorkspaceDataTables(workspace.path);
}

export async function createDataTable(workspaceId, name) {
  const workspace = await getWorkspace(workspaceId);
  return createWorkspaceDataTable(workspace.path, name);
}

export async function getDataTable(workspaceId, table, options = {}) {
  const workspace = await getWorkspace(workspaceId);
  await listInboxes(workspace.id, { includeDisabled: true });
  return readWorkspaceDataTable(workspace.path, table, options);
}

export async function updateDataCell(workspaceId, table, rowId, column, value) {
  const workspace = await getWorkspace(workspaceId);
  return updateWorkspaceDataCell(workspace.path, table, rowId, column, value);
}

export async function addDataRow(workspaceId, table, values = {}) {
  const workspace = await getWorkspace(workspaceId);
  return addWorkspaceDataRow(workspace.path, table, values);
}

export async function addDataColumn(workspaceId, table, name) {
  const workspace = await getWorkspace(workspaceId);
  return addWorkspaceDataColumn(workspace.path, table, name);
}

export async function renameDataColumn(workspaceId, table, column, name) {
  const workspace = await getWorkspace(workspaceId);
  return renameWorkspaceDataColumn(workspace.path, table, column, name);
}

export async function deleteDataColumn(workspaceId, table, column) {
  const workspace = await getWorkspace(workspaceId);
  return deleteWorkspaceDataColumn(workspace.path, table, column);
}

export async function moveDataColumn(workspaceId, table, column, direction) {
  const workspace = await getWorkspace(workspaceId);
  return moveWorkspaceDataColumn(workspace.path, table, column, direction);
}

export async function deleteDataRow(workspaceId, table, rowId) {
  const workspace = await getWorkspace(workspaceId);
  return deleteWorkspaceDataRow(workspace.path, table, rowId);
}

export async function writeDataRows(workspaceId, table, rows, keyColumns = []) {
  const workspace = await getWorkspace(workspaceId);
  return writeWorkspaceDataRows(workspace.path, table, rows, { keyColumns });
}

export async function listFiles(workspaceId, relativePath = '.') {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => !['.git', '.runlet', 'node_modules', '.DS_Store'].includes(entry.name)).map(async (entry) => {
    const itemPath = path.join(directory, entry.name);
    const stat = await fs.stat(itemPath);
    const itemRelativePath = path.relative(workspace.path, itemPath) || '.';
    return {
      name: entry.name,
      path: itemRelativePath,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      inbox: entry.isDirectory() ? await describeInboxFolder(workspace, itemRelativePath) : null,
    };
  }));
}

export async function readFile(workspaceId, relativePath) { const workspace = await getWorkspace(workspaceId); return fs.readFile(resolveInside(workspace.path, relativePath), 'utf8'); }
export async function writeFile(workspaceId, relativePath, content) { const workspace = await getWorkspace(workspaceId); const target = resolveInside(workspace.path, relativePath); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); return { path: relativePath }; }
export async function makeDirectory(workspaceId, relativePath) {
  const workspace = await getWorkspace(workspaceId);
  const target = resolveInside(workspace.path, relativePath);
  if (target === path.resolve(workspace.path)) throw new Error('Choose a name for the new folder.');
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error('A file or folder with that name already exists.');
  await fs.mkdir(target, { recursive: true });
  return { path: relativePath };
}
export async function moveFile(workspaceId, from, to) {
  const workspace = await getWorkspace(workspaceId);
  const source = resolveInside(workspace.path, from);
  const target = resolveInside(workspace.path, to);
  if (source === path.resolve(workspace.path)) throw new Error('The workspace folder cannot be moved.');
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('A folder cannot be moved into itself.');
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error('A file or folder with that name already exists there.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  return { path: to };
}
export async function copyFile(workspaceId, from, to) {
  const workspace = await getWorkspace(workspaceId);
  const source = resolveInside(workspace.path, from);
  const target = resolveInside(workspace.path, to);
  if (source === path.resolve(workspace.path)) throw new Error('The workspace folder cannot be copied.');
  const sourceStat = await fs.stat(source).catch(() => null);
  if (!sourceStat) throw new Error('That file no longer exists.');
  if (!sourceStat.isFile()) throw new Error('Drag individual files to copy them.');
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('A folder cannot be copied into itself.');
  if (await fs.access(target).then(() => true).catch(() => false)) throw new Error('A file or folder with that name already exists there.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
  return { path: to };
}

export async function uploadFiles(workspaceId, relativeFolder, files) {
  const workspace = await getWorkspace(workspaceId);
  const directory = resolveInside(workspace.path, relativeFolder || '.');
  const stat = await fs.stat(directory).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('Drop files into a folder.');
  if (!Array.isArray(files) || !files.length) throw new Error('No files were dropped.');
  const prepared = files.map((file) => {
    const name = String(file?.name || '');
    if (!name || name === '.' || name === '..' || name !== path.basename(name) || /[\\/]/.test(name)) throw new Error('A dropped file has an invalid name.');
    const target = resolveInside(directory, name);
    const bytes = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || []);
    return { name, target, bytes };
  });
  if (new Set(prepared.map((file) => file.name.toLowerCase())).size !== prepared.length) throw new Error('Two dropped files have the same name.');
  for (const file of prepared) if (await fs.access(file.target).then(() => true).catch(() => false)) throw new Error(`${file.name} already exists in that folder.`);
  await Promise.all(prepared.map((file) => fs.writeFile(file.target, file.bytes, { flag: 'wx' })));
  return { copied: prepared.map((file) => file.name), folder: relativeFolder || '.' };
}
export async function deleteFile(workspaceId, relativePath) {
  const workspace = await getWorkspace(workspaceId);
  const target = resolveInside(workspace.path, relativePath);
  if (target === path.resolve(workspace.path)) throw new Error('Cannot delete a workspace root.');
  await fs.rm(target, { recursive: true });
  await deleteInboxTables(workspace.path, path.relative(workspace.path, target));
}

export async function listDirectories(folderPath = os.homedir()) {
  const resolved = path.resolve(String(folderPath).replace(/^~(?=$|\/)/, os.homedir()));
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return { path: resolved, parent: path.dirname(resolved), directories: entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) })).sort((a, b) => a.name.localeCompare(b.name)) };
}
