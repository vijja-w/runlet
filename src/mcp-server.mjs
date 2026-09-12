import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as runlet from './workspaces.mjs';
import { mcpToolDescriptions } from './mcp-tools.mjs';

const instructions = `Runlet manages explicitly registered local workspaces, Scripts, and Prompts.

Before reading or changing files, identify the intended workspace. Call get_current_workspace when the user refers to the active workspace. Call list_workspaces when it is ambiguous. If the user names a workspace, select it and pass its workspaceId to every later operation. Never modify an unregistered folder.

Scripts are small local apps under scripts/<kebab-case-slug>/. Each has runlet.json, README.md, run.js, inputs/, and outputs/. runlet.json declares its editable name, description, interactive controls, and result panels. Runlet generates the normal interface; index.html is optional for a specialized dashboard. When asked to create a Script, call get_script_template and then create_script. run.js receives { workspace, run, input, pdf, csv, zip, xlsx, docx } and may use only the provided APIs. Binary files use workspace.readBytes and workspace.writeBytes. Run Scripts with run_script and inspect their outputs. If a run fails, call get_script_run_history to inspect its final error and run.log messages.

Prompts are reusable AI instructions under prompts/<kebab-case-slug>/PROMPT.md. They are not programs and do not launch a second AI. When asked to create a Prompt, call get_prompt_template and then create_prompt. When asked to use a Prompt, call get_prompt and follow its content using files attached to the conversation or explicitly named workspace files. The user can also copy a Prompt from Runlet and paste it into any compatible AI.

Inboxes are explicitly enabled folders containing runlet.json, INSTRUCTIONS.md, data.csv, processed/, and needs-review/. Loose files in an Inbox root are waiting to be processed. Always call list_inboxes instead of scanning for instruction files, then call get_inbox to read the instructions for an Inbox before processing it. Process only enabled, ready Inboxes; leave an Inbox untouched when it needs attention. For each ready Inbox, follow its instructions, update its data file, move successful source files to its processed folder, and move genuinely ambiguous files to its needs-review folder.`;

const server = new McpServer({ name: 'runlet', version: '0.18.0' }, { instructions });
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
  description: mcpToolDescriptions.list_workspaces,
  inputSchema: z.object({}),
}, async () => textResult(await runlet.listWorkspaces()));

server.registerTool('get_current_workspace', {
  description: mcpToolDescriptions.get_current_workspace,
  inputSchema: z.object({}),
}, async () => textResult(await runlet.getCurrentWorkspace()));

server.registerTool('create_workspace', {
  description: mcpToolDescriptions.create_workspace,
  inputSchema: z.object({
    name: z.string().min(1),
    folderPath: z.string().optional().describe('Absolute folder path. Omit to use ~/Runlet Workspaces/<name>.'),
    create: z.boolean().default(true),
  }),
}, async (input) => textResult(await runlet.createWorkspace(input)));

server.registerTool('select_workspace', {
  description: mcpToolDescriptions.select_workspace,
  inputSchema: z.object({ workspaceId: z.string() }),
}, async ({ workspaceId: id }) => textResult(await runlet.selectWorkspace(id)));

server.registerTool('update_workspace', {
  description: mcpToolDescriptions.update_workspace,
  inputSchema: z.object({ workspaceId: z.string(), name: z.string().min(1) }),
}, async ({ workspaceId: id, name }) => textResult(await runlet.updateWorkspace(id, { name })));

server.registerTool('remove_workspace', {
  description: mcpToolDescriptions.remove_workspace,
  inputSchema: z.object({ workspaceId: z.string() }),
}, async ({ workspaceId: id }) => textResult(await runlet.removeWorkspace(id)));

server.registerTool('list_files', {
  description: mcpToolDescriptions.list_files,
  inputSchema: z.object({ workspaceId, path: z.string().default('.') }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.listFiles(id, target)));

server.registerTool('list_inboxes', {
  description: mcpToolDescriptions.list_inboxes,
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listInboxes(id)));

server.registerTool('get_inbox', {
  description: mcpToolDescriptions.get_inbox,
  inputSchema: z.object({ workspaceId, path: z.string().min(1).describe('Path to the Inbox folder, relative to the workspace.') }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.getInbox(id, target)));

server.registerTool('update_inbox_instructions', {
  description: mcpToolDescriptions.update_inbox_instructions,
  inputSchema: z.object({
    workspaceId,
    path: z.string().min(1).describe('Path to the Inbox folder, relative to the workspace.'),
    content: z.string().describe('Complete Markdown content for the Inbox instructions.'),
  }),
}, async ({ workspaceId: id, path: target, content }) => textResult(await runlet.updateInboxInstructions(id, target, content)));

server.registerTool('read_file', {
  description: mcpToolDescriptions.read_file,
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.readFile(id, target)));

server.registerTool('write_file', {
  description: mcpToolDescriptions.write_file,
  inputSchema: z.object({ workspaceId, path: z.string(), content: z.string() }),
}, async ({ workspaceId: id, path: target, content }) => textResult(await runlet.writeFile(id, target, content)));

server.registerTool('create_directory', {
  description: mcpToolDescriptions.create_directory,
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => textResult(await runlet.makeDirectory(id, target)));

server.registerTool('move_file', {
  description: mcpToolDescriptions.move_file,
  inputSchema: z.object({ workspaceId, from: z.string(), to: z.string() }),
}, async ({ workspaceId: id, from, to }) => textResult(await runlet.moveFile(id, from, to)));

server.registerTool('delete_file', {
  description: mcpToolDescriptions.delete_file,
  inputSchema: z.object({ workspaceId, path: z.string() }),
}, async ({ workspaceId: id, path: target }) => {
  await runlet.deleteFile(id, target);
  return textResult({ deleted: target });
});

server.registerTool('list_scripts', {
  description: mcpToolDescriptions.list_scripts,
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listScripts(id)));

server.registerTool('get_script', {
  description: mcpToolDescriptions.get_script,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getScript(id, slug)));

server.registerTool('get_script_template', {
  description: mcpToolDescriptions.get_script_template,
  inputSchema: z.object({ withView: z.boolean().default(false) }),
}, async ({ withView }) => textResult(runlet.getScriptTemplate(withView)));

server.registerTool('create_script', {
  description: mcpToolDescriptions.create_script,
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
  description: mcpToolDescriptions.run_script,
  inputSchema: z.object({ workspaceId, slug: z.string(), input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }),
}, async ({ workspaceId: id, slug, input }) => textResult(await runlet.runScript(id, slug, input)));

server.registerTool('get_script_run_history', {
  description: mcpToolDescriptions.get_script_run_history,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getScriptRunHistory(id, slug)));

server.registerTool('get_script_results', {
  description: mcpToolDescriptions.get_script_results,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getScriptResults(id, slug)));

server.registerTool('update_script_metadata', {
  description: mcpToolDescriptions.update_script_metadata,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string().optional(), description: z.string().optional() }),
}, async ({ workspaceId: id, slug, name, description }) => textResult(await runlet.updateScriptMetadata(id, slug, { name, description })));

server.registerTool('delete_script', {
  description: mcpToolDescriptions.delete_script,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.deleteScript(id, slug)));

server.registerTool('read_script_input', {
  description: mcpToolDescriptions.read_script_input,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string() }),
}, async ({ workspaceId: id, slug, name }) => {
  const input = await runlet.readScriptInput(id, slug, name);
  const extension = path.extname(name).toLowerCase();
  const mimeType = ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.csv': 'text/csv', '.txt': 'text/plain' })[extension] || 'application/octet-stream';
  return { content: [{ type: 'resource', resource: { uri: `runlet://scripts/${encodeURIComponent(slug)}/inputs/${encodeURIComponent(name)}`, mimeType, blob: input.data.toString('base64') } }] };
});

server.registerTool('write_script_input', {
  description: mcpToolDescriptions.write_script_input,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), ...encodedData }),
}, async ({ workspaceId: id, slug, name, data, encoding }) => textResult(await runlet.writeScriptInput(id, slug, name, Buffer.from(data, encoding))));

server.registerTool('write_script_output', {
  description: mcpToolDescriptions.write_script_output,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), ...encodedData }),
}, async ({ workspaceId: id, slug, name, data, encoding }) => textResult(await runlet.writeScriptOutput(id, slug, name, Buffer.from(data, encoding))));

server.registerTool('list_prompts', {
  description: mcpToolDescriptions.list_prompts,
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listPrompts(id)));

server.registerTool('get_prompt', {
  description: mcpToolDescriptions.get_prompt,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getPrompt(id, slug)));

server.registerTool('get_prompt_template', {
  description: mcpToolDescriptions.get_prompt_template,
  inputSchema: z.object({}),
}, async () => textResult(runlet.getPromptTemplate()));

server.registerTool('create_prompt', {
  description: mcpToolDescriptions.create_prompt,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string(), description: z.string(), content: z.string(), overwrite: z.boolean().default(false) }),
}, async (input) => textResult(await runlet.createPrompt(input)));

server.registerTool('update_prompt', {
  description: mcpToolDescriptions.update_prompt,
  inputSchema: z.object({ workspaceId, slug: z.string(), content: z.string() }),
}, async ({ workspaceId: id, slug, content }) => textResult(await runlet.updatePrompt(id, slug, content)));

server.registerTool('update_prompt_metadata', {
  description: mcpToolDescriptions.update_prompt_metadata,
  inputSchema: z.object({ workspaceId, slug: z.string(), name: z.string().optional(), description: z.string().optional() }),
}, async ({ workspaceId: id, slug, name, description }) => textResult(await runlet.updatePromptMetadata(id, slug, { name, description })));

server.registerTool('delete_prompt', {
  description: mcpToolDescriptions.delete_prompt,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.deletePrompt(id, slug)));

await server.connect(new StdioServerTransport());
