import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as workshop from './workspaces.mjs';
import * as connections from './connections.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.PORT || 4173);
const instanceToken = process.env.RUNLET_INSTANCE_TOKEN || '';

app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(appRoot, 'public')));

function route(handler) {
  return async (request, response) => {
    try { const result = await handler(request, response); if (!response.headersSent) response.json(result ?? { ok: true }); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  };
}

function sendFile(response, target) {
  return new Promise((resolve, reject) => response.sendFile(target, (error) => error ? reject(error) : resolve()));
}

app.get('/api/state', route(async () => {
  const state = await workshop.listWorkspaces();
  const selected = state.workspaces.find((item) => item.id === state.selectedId) || null;
  const scripts = selected ? await workshop.listScripts(selected.id) : [];
  const prompts = selected ? await workshop.listPrompts(selected.id) : [];
  const files = selected ? await workshop.listFiles(selected.id) : [];
  return { ...state, selected, scripts, prompts, files, defaultFolder: path.join(os.homedir(), 'Runlet Workspaces') };
}));
app.get('/api/health', (_request, response) => response.json({ ok: true, name: 'runlet', pid: process.pid, instanceToken }));
app.get('/api/connections', route(async () => connections.listConnections()));
app.post('/api/connections/:provider', route(async ({ params }) => connections.connect(params.provider)));
app.delete('/api/connections/:provider', route(async ({ params }) => connections.disconnect(params.provider)));
app.post('/api/workspaces', route(async ({ body }) => workshop.createWorkspace(body)));
app.post('/api/workspaces/:id/select', route(async ({ params }) => workshop.selectWorkspace(params.id)));
app.patch('/api/workspaces/:id', route(async ({ params, body }) => workshop.updateWorkspace(params.id, body)));
app.delete('/api/workspaces/:id', route(async ({ params }) => workshop.removeWorkspace(params.id)));
app.get('/api/directories', route(async ({ query }) => workshop.listDirectories(query.path || os.homedir())));
app.get('/api/files', route(async ({ query }) => workshop.listFiles(query.workspaceId, query.path || '.')));
app.get('/api/files/read', route(async ({ query }) => ({ content: await workshop.readFile(query.workspaceId, query.path) })));
app.put('/api/files', route(async ({ body }) => workshop.writeFile(body.workspaceId, body.path, body.content)));
app.post('/api/files/open', route(async ({ body }) => {
  const workspace = await workshop.getWorkspace(body.workspaceId);
  const target = workshop.resolveInside(workspace.path, body.path);
  await openLocalFile(target);
  return { opened: body.path };
}));
app.post('/api/scripts/:slug/run', route(async ({ params, body }) => workshop.runScript(body.workspaceId, params.slug, body.input || {})));
app.get('/api/scripts/:slug/results', route(async ({ params, query }) => workshop.getScriptResults(query.workspaceId, params.slug)));
app.patch('/api/scripts/:slug', route(async ({ params, body }) => workshop.updateScriptMetadata(body.workspaceId, params.slug, body)));
app.delete('/api/scripts/:slug', route(async ({ params, body }) => workshop.deleteScript(body.workspaceId, params.slug)));
app.put('/api/order/:kind', route(async ({ params, body }) => workshop.reorderItems(body.workspaceId, params.kind, body.slugs)));
app.post('/api/scripts/:slug/inputs', route(async ({ params, body }) => workshop.writeScriptInput(body.workspaceId, params.slug, body.name, Buffer.from(body.data, 'base64'))));
app.put('/api/prompts/:slug', route(async ({ params, body }) => workshop.updatePrompt(body.workspaceId, params.slug, body.content)));
app.patch('/api/prompts/:slug', route(async ({ params, body }) => workshop.updatePromptMetadata(body.workspaceId, params.slug, body)));
app.delete('/api/prompts/:slug', route(async ({ params, body }) => workshop.deletePrompt(body.workspaceId, params.slug)));

app.get('/script-view/:workspaceId/:slug/*rest', route(async (request, response) => {
  const workspace = await workshop.getWorkspace(request.params.workspaceId);
  await workshop.getScript(workspace.id, request.params.slug);
  const relative = Array.isArray(request.params.rest) ? request.params.rest.join('/') : request.params.rest || 'index.html';
  const scriptRoot = workshop.resolveInside(workspace.path, path.join('scripts', request.params.slug));
  const target = workshop.resolveInside(scriptRoot, relative);
  await sendFile(response, target);
}));
app.get('/script-view/:workspaceId/:slug', (request, response) => response.redirect(`/script-view/${request.params.workspaceId}/${request.params.slug}/index.html`));
app.get('/script-output/:workspaceId/:slug/*rest', route(async (request, response) => {
  const workspace = await workshop.getWorkspace(request.params.workspaceId);
  await workshop.getScript(workspace.id, request.params.slug);
  const relative = Array.isArray(request.params.rest) ? request.params.rest.join('/') : request.params.rest;
  const outputRoot = workshop.resolveInside(workspace.path, path.join('scripts', request.params.slug, 'outputs'));
  await sendFile(response, workshop.resolveInside(outputRoot, relative));
}));

const server = app.listen(port, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`\nRunlet is ready: ${url}\n`);
  if (process.env.NO_OPEN !== '1') openBrowser(url);
});

server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function openLocalFile(target) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
