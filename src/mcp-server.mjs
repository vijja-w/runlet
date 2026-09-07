import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as runlet from './workspaces.mjs';

const instructions = `Runlet manages explicitly registered local workspaces, Scripts, and Prompts.

Before reading or changing files, identify the intended workspace. Call get_current_workspace when the user refers to the active workspace. Call list_workspaces when it is ambiguous. If the user names a workspace, select it and pass its workspaceId to every later operation. Never modify an unregistered folder.

Scripts are small local apps under scripts/<kebab-case-slug>/. Each has runlet.json, README.md, run.js, inputs/, and outputs/. runlet.json declares its editable name, description, interactive controls, and result panels. Runlet generates the normal interface; index.html is optional for a specialized dashboard. When asked to create a Script, call get_script_template and then create_script. run.js receives { workspace, run, input } and may use only the provided APIs. Run Scripts with run_script and inspect their outputs.

Prompts are reusable AI instructions under prompts/<kebab-case-slug>/PROMPT.md. They are not programs and do not launch a second AI. When asked to create a Prompt, call get_prompt_template and then create_prompt. When asked to use a Prompt, call get_prompt and follow its content using files attached to the conversation or explicitly named workspace files. The user can also copy a Prompt from Runlet and paste it into any compatible AI.`;

const server = new McpServer({ name: 'runlet', version: '0.3.0' }, { instructions });
const textResult = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const workspaceId = z.string().optional().describe('Registered workspace ID. Omit only when the intended workspace is already selected.');
const encodedData = {
  data: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
};
const scriptControl = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'select']),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number()]).optional(),
  options: z.array(z.string()).optional(),
  source: z.object({ type: z.literal('csv-column'), path: z.string(), column: z.string() }).optional(),
});
const scriptResult = z.object({
  type: z.enum(['summary', 'text', 'table']),
  label: z.string(),
  path: z.string().describe('Path beneath outputs/, relative to the Script folder.'),
});

server.registerTool('list_workspaces', {
  description: 'List registered Runlet workspaces and identify the selected workspace.',
  inputSchema: z.object({}),
}, async () => textResult(await runlet.listWorkspaces()));

server.registerTool('get_current_workspace', {
  description: 'Return the currently selected workspace. Use when the user says current, active, or selected workspace.',
  inputSchema: z.object({}),
}, async () => textResult(await runlet.getCurrentWorkspace()));

server.registerTool('create_workspace', {
  description: 'Create a workspace folder or register an existing folder.',
  inputSchema: z.object({
    name: z.string().min(1),
    folderPath: z.string().optional().describe('Absolute folder path. Omit to use ~/Runlet Workspaces/<name>.'),
    create: z.boolean().default(true),
  }),
}, async (input) => textResult(await runlet.createWorkspace(input)));

server.registerTool('select_workspace', {
  description: 'Select a registered workspace for the UI and as the default for later tools.',
  inputSchema: z.object({ workspaceId: z.string() }),
}, async ({ workspaceId: id }) => textResult(await runlet.selectWorkspace(id)));

server.registerTool('update_workspace', {
  description: 'Rename a registered workspace. Workspace names must be unique.',
  inputSchema: z.object({ workspaceId: z.string(), name: z.string().min(1) }),
}, async ({ workspaceId: id, name }) => textResult(await runlet.updateWorkspace(id, { name })));

server.registerTool('remove_workspace', {
  description: 'Remove a workspace registration without deleting its folder or files.',
  inputSchema: z.object({ workspaceId: z.string() }),
}, async ({ workspaceId: id }) => textResult(await runlet.removeWorkspace(id)));

server.registerTool('list_files', {
  description: 'List one directory inside a registered workspace.',
  inputSchema: z.object({ workspaceId, path: z.string().default('.') }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.listFiles(id, target)));

server.registerTool('read_file', {
  description: 'Read a UTF-8 text file inside a registered workspace.',
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.readFile(id, target)));

server.registerTool('write_file', {
  description: 'Create or replace a UTF-8 text file inside a registered workspace.',
  inputSchema: z.object({ workspaceId, path: z.string(), content: z.string() }),
}, async ({ workspaceId: id, path: target, content }) => textResult(await runlet.writeFile(id, target, content)));

server.registerTool('create_directory', {
  description: 'Create a folder inside a registered workspace.',
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.makeDirectory(id, target)));

server.registerTool('move_file', {
  description: 'Rename or move a file or folder inside the same workspace.',
  inputSchema: z.object({ workspaceId, from: z.string(), to: z.string() }),
}, async ({ workspaceId: id, from, to }) => textResult(await runlet.moveFile(id, from, to)));

server.registerTool('delete_file', {
  description: 'Delete a file or folder inside a workspace. Never deletes the workspace root.',
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => {
  await runlet.deleteFile(id, target);
  return textResult({ deleted: target });
});

server.registerTool('list_scripts', {
  description: 'List runnable Scripts in a workspace, including inputs, outputs, and view availability.',
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listScripts(id)));

server.registerTool('get_script', {
  description: 'Read one Script’s metadata and instructions.',
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getScript(id, slug)));

server.registerTool('get_script_template', {
  description: 'Get the authoritative Script structure and rules. Always call before create_script.',
  inputSchema: z.object({ withView: z.boolean().default(false) }),
}, async ({ withView }) => textResult(runlet.getScriptTemplate(withView)));

server.registerTool('create_script', {
  description: 'Create a validated local Script mini-app with generated controls and result panels. Creates inputs/ and outputs/ automatically.',
  inputSchema: z.object({
    workspaceId,
    slug: z.string().describe('Lower-case kebab-case folder name.'),
    name: z.string().describe('Editable display name.'),
    description: z.string().describe('Editable one-sentence description.'),
    controls: z.array(scriptControl).default([]).describe('Fields shown above the Run button.'),
    results: z.array(scriptResult).default([]).describe('Output files Runlet displays after a run.'),
    readme: z.string().describe('Plain-language README.md beginning with one # title.'),
    runJs: z.string().describe('Complete run.js exporting one default function.'),
    indexHtml: z.string().optional(),
    overwrite: z.boolean().default(false),
  }),
}, async (input) => textResult(await runlet.createScript(input)));

server.registerTool('run_script', {
  description: 'Run a local Script and return its logs. Inspect its outputs before reporting completion.',
  inputSchema: z.object({ workspaceId, slug: z.string(), input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }),
}, async ({ workspaceId: id, slug, input }) => textResult(await runlet.runScript(id, slug, input)));

server.registerTool('get_script_results', {
  description: 'Read the Script outputs declared as summary, text, or table result panels.',
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getScriptResults(id, slug)));

server.registerTool('update_script_metadata', {
  description: 'Change a Script’s display name or description without renaming its folder.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string().optional(), description: z.string().optional() }),
}, async ({ workspaceId: id, slug, name, description }) => textResult(await runlet.updateScriptMetadata(id, slug, { name, description })));

server.registerTool('read_script_input', {
  description: 'Read a binary or text Script input as an embedded resource.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string() }),
}, async ({ workspaceId: id, slug, name }) => {
  const input = await runlet.readScriptInput(id, slug, name);
  const extension = path.extname(name).toLowerCase();
  const mimeType = ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.csv': 'text/csv', '.txt': 'text/plain' })[extension] || 'application/octet-stream';
  return { content: [{ type: 'resource', resource: { uri: `runlet://scripts/${encodeURIComponent(slug)}/inputs/${encodeURIComponent(name)}`, mimeType, blob: input.data.toString('base64') } }] };
});

server.registerTool('write_script_input', {
  description: 'Add or replace a Script input using UTF-8 text or base64 binary data.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), ...encodedData }),
}, async ({ workspaceId: id, slug, name, data, encoding }) => textResult(await runlet.writeScriptInput(id, slug, name, Buffer.from(data, encoding))));

server.registerTool('write_script_output', {
  description: 'Write UTF-8 text or base64 binary data beneath a Script outputs/ directory.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), ...encodedData }),
}, async ({ workspaceId: id, slug, name, data, encoding }) => textResult(await runlet.writeScriptOutput(id, slug, name, Buffer.from(data, encoding))));

server.registerTool('list_prompts', {
  description: 'List reusable Prompts in a workspace.',
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listPrompts(id)));

server.registerTool('get_prompt', {
  description: 'Get a saved Prompt. When the user asks to use it, follow the returned content with their attached or named files.',
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getPrompt(id, slug)));

server.registerTool('get_prompt_template', {
  description: 'Get the authoritative Prompt structure and authoring rules. Always call before create_prompt.',
  inputSchema: z.object({}),
}, async () => textResult(runlet.getPromptTemplate()));

server.registerTool('create_prompt', {
  description: 'Create a reusable provider-neutral Prompt in a workspace.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), description: z.string(), content: z.string(), overwrite: z.boolean().default(false) }),
}, async (input) => textResult(await runlet.createPrompt(input)));

server.registerTool('update_prompt', {
  description: 'Replace the content of an existing Prompt.',
  inputSchema: z.object({ workspaceId, slug: z.string(), content: z.string() }),
}, async ({ workspaceId: id, slug, content }) => textResult(await runlet.updatePrompt(id, slug, content)));

server.registerTool('update_prompt_metadata', {
  description: 'Change a Prompt’s display name or description without changing its instructions or folder name.',
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string().optional(), description: z.string().optional() }),
}, async ({ workspaceId: id, slug, name, description }) => textResult(await runlet.updatePromptMetadata(id, slug, { name, description })));

server.registerTool('delete_prompt', {
  description: 'Permanently delete a Prompt. Use only when the user explicitly asks.',
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.deletePrompt(id, slug)));

await server.connect(new StdioServerTransport());
