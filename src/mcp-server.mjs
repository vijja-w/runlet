import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as runlet from './workspaces.mjs';
import { mcpToolDescriptions } from './mcp-tools.mjs';

const instructions = `Runlet manages explicitly registered local workspaces, Apps, and Prompts.

Before reading or changing files, call list_workspaces to identify the intended registered workspace and its workspaceId. The result identifies the selected workspace. If the user names another workspace, call select_workspace before continuing. Pass its workspaceId to every later operation. Never modify an unregistered folder.

Apps are portable local programs under apps/<kebab-case-slug>/. Each has runlet.json, README.md, run.js, inputs/, and outputs/. runlet.json declares its editable name, description, interactive controls, and result panels. Every App has its own Runlet page. Runlet generates a compact interface from the manifest; index.html may provide a richer browser interface. Before creating or substantially editing an App, call get_app_template. Use create_directory and write_file to create its folder and files; use list_apps and get_app to locate an existing App. run.js receives { workspace, run, input, data, pdf, csv, zip, xlsx, docx } and may use only the provided APIs. Use data.read/insert/upsert for workspace tables. Binary files use workspace.readBytes and workspace.writeBytes. Keep App assets inside the App folder, use relative URLs, avoid CDNs unless they are genuinely necessary, and do not rely on machine-specific installs or paths. Run Apps with run_app, then read their declared output paths with read_file. If a run fails, call get_app_run_history to inspect its final error, technical details, and run.log or console messages. Delete an App with delete_file only when the user explicitly requests deletion.

Prompts are reusable AI instructions under prompts/<kebab-case-slug>/PROMPT.md with metadata in runlet.json. They are not programs and do not launch a second AI. Before creating or substantially editing a Prompt, call get_prompt_template, then use write_file for its files. Use list_prompts and get_prompt to discover and read existing Prompts. When asked to use a Prompt, follow its content using files attached to the conversation or explicitly named workspace files. Delete a Prompt with delete_file only when the user explicitly requests deletion.

Inboxes are explicitly enabled folders containing runlet.json, INSTRUCTIONS.md, processed/, and needs-review/. Each Inbox owns a table in the workspace database. Loose files in an Inbox root are waiting to be processed. Always call list_inboxes instead of scanning for instruction files, then call get_inbox to read the instructions and exact table name before processing it. Process only enabled, ready Inboxes; leave an Inbox untouched when it needs attention. For each ready Inbox, follow its instructions, write rows with write_data_rows, move successful source files to its processed folder, and move genuinely ambiguous files to its needs-review folder. Use source_file plus source_row as keys when the instructions call for idempotent line-item processing.

The workspace can also contain standalone user-created Tables. Use list_data_tables to resolve the exact table_name and distinguish Inbox tables from standalone Tables, then use get_data_table before editing. Use the structured Data tools instead of opening or editing the SQLite database file directly. Row IDs returned by get_data_table identify rows for cell edits and deletion. write_data_rows can insert many rows or update matching rows using keyColumns. add_data_column creates a text column; columns first introduced by write_data_rows may be stored internally as text, integer, or real based on their values. Types are an internal detail and are not user-facing. Use rename_data_column and move_data_column for non-destructive structure changes, and delete tools only when the user explicitly requested deletion.`;

const server = new McpServer({ name: 'runlet', version: '0.18.0' }, { instructions });
const textResult = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const workspaceId = z.string().optional().describe('Registered workspace ID. Omit only when the intended workspace is already selected.');
const encodedData = {
  data: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
};

server.registerTool('list_workspaces', {
  description: mcpToolDescriptions.list_workspaces,
  inputSchema: z.object({}),
}, async () => textResult(await runlet.listWorkspaces()));

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

server.registerTool('list_data_tables', {
  description: mcpToolDescriptions.list_data_tables,
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listDataTables(id)));

server.registerTool('create_data_table', {
  description: mcpToolDescriptions.create_data_table,
  inputSchema: z.object({ workspaceId, name: z.string().min(1).describe('User-facing table name. It must be unique within the workspace.') }),
}, async ({ workspaceId: id, name }) => textResult(await runlet.createDataTable(id, name)));

server.registerTool('delete_data_table', {
  description: mcpToolDescriptions.delete_data_table,
  inputSchema: z.object({ workspaceId, table: z.string().describe('Exact standalone table_name returned by list_data_tables.') }),
}, async ({ workspaceId: id, table }) => textResult(await runlet.deleteDataTable(id, table)));

server.registerTool('get_data_table', {
  description: mcpToolDescriptions.get_data_table,
  inputSchema: z.object({ workspaceId, table: z.string().describe('Exact table_name returned by list_data_tables or get_inbox.'), limit: z.number().int().min(1).max(5000).default(1000), offset: z.number().int().min(0).default(0) }),
}, async ({ workspaceId: id, table, limit, offset }) => textResult(await runlet.getDataTable(id, table, { limit, offset })));

server.registerTool('write_data_rows', {
  description: mcpToolDescriptions.write_data_rows,
  inputSchema: z.object({
    workspaceId,
    table: z.string().describe('Exact table_name returned by list_data_tables or get_inbox.'),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    keyColumns: z.array(z.string()).default([]).describe('Existing column names that identify a row to update. Leave empty to insert every row.'),
  }),
}, async ({ workspaceId: id, table, rows, keyColumns }) => textResult(await runlet.writeDataRows(id, table, rows, keyColumns)));

server.registerTool('update_data_cell', {
  description: mcpToolDescriptions.update_data_cell,
  inputSchema: z.object({ workspaceId, table: z.string(), rowId: z.number().int().positive(), column: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
}, async ({ workspaceId: id, table, rowId, column, value }) => textResult(await runlet.updateDataCell(id, table, rowId, column, value)));

server.registerTool('delete_data_row', {
  description: mcpToolDescriptions.delete_data_row,
  inputSchema: z.object({ workspaceId, table: z.string(), rowId: z.number().int().positive() }),
}, async ({ workspaceId: id, table, rowId }) => textResult(await runlet.deleteDataRow(id, table, rowId)));

server.registerTool('add_data_column', {
  description: mcpToolDescriptions.add_data_column,
  inputSchema: z.object({ workspaceId, table: z.string(), name: z.string().min(1) }),
}, async ({ workspaceId: id, table, name }) => textResult(await runlet.addDataColumn(id, table, name)));

server.registerTool('rename_data_column', {
  description: mcpToolDescriptions.rename_data_column,
  inputSchema: z.object({ workspaceId, table: z.string(), column: z.string(), name: z.string().min(1) }),
}, async ({ workspaceId: id, table, column, name }) => textResult(await runlet.renameDataColumn(id, table, column, name)));

server.registerTool('delete_data_column', {
  description: mcpToolDescriptions.delete_data_column,
  inputSchema: z.object({ workspaceId, table: z.string(), column: z.string() }),
}, async ({ workspaceId: id, table, column }) => textResult(await runlet.deleteDataColumn(id, table, column)));

server.registerTool('move_data_column', {
  description: mcpToolDescriptions.move_data_column,
  inputSchema: z.object({ workspaceId, table: z.string(), column: z.string(), direction: z.enum(['left', 'right']) }),
}, async ({ workspaceId: id, table, column, direction }) => textResult(await runlet.moveDataColumn(id, table, column, direction)));

server.registerTool('read_file', {
  description: mcpToolDescriptions.read_file,
  inputSchema: z.object({ workspaceId, path: z.string(), encoding: z.enum(['utf8', 'base64']).default('utf8') }),
}, async ({ workspaceId: id, path: target, encoding }) => textResult(await runlet.readFileEncoded(id, target, encoding)));

server.registerTool('write_file', {
  description: mcpToolDescriptions.write_file,
  inputSchema: z.object({ workspaceId, path: z.string(), ...encodedData }),
}, async ({ workspaceId: id, path: target, data, encoding }) => textResult(await runlet.writeFileEncoded(id, target, data, encoding)));

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

server.registerTool('list_apps', {
  description: mcpToolDescriptions.list_apps,
  inputSchema: z.object({ workspaceId }),
}, async ({ workspaceId: id }) => textResult(await runlet.listApps(id)));

server.registerTool('get_app', {
  description: mcpToolDescriptions.get_app,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getApp(id, slug)));

server.registerTool('get_app_template', {
  description: mcpToolDescriptions.get_app_template,
  inputSchema: z.object({ includePage: z.boolean().default(false).describe('Include index.html in the recommended structure for a richer browser interface.') }),
}, async ({ includePage }) => textResult(runlet.getAppTemplate(includePage)));

server.registerTool('run_app', {
  description: mcpToolDescriptions.run_app,
  inputSchema: z.object({ workspaceId, slug: z.string(), input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }),
}, async ({ workspaceId: id, slug, input }) => textResult(await runlet.runApp(id, slug, input)));

server.registerTool('get_app_run_history', {
  description: mcpToolDescriptions.get_app_run_history,
  inputSchema: z.object({ workspaceId, slug: z.string() }),
}, async ({ workspaceId: id, slug }) => textResult(await runlet.getAppRunHistory(id, slug)));

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

await server.connect(new StdioServerTransport());
