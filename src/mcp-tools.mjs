export const mcpToolGroups = [
  {
    name: 'Workspaces',
    tools: [
      ['list_workspaces', 'List registered Runlet workspaces and identify the selected workspace.'],
      ['get_current_workspace', 'Return the currently selected workspace. Use when the user says current, active, or selected workspace.'],
      ['create_workspace', 'Create a workspace folder or register an existing folder.'],
      ['select_workspace', 'Select a registered workspace for the UI and as the default for later tools.'],
      ['update_workspace', 'Rename a registered workspace. Workspace names must be unique.'],
      ['remove_workspace', 'Remove a workspace registration without deleting its folder or files.'],
    ],
  },
  {
    name: 'Files and Inboxes',
    tools: [
      ['list_files', 'List one directory inside a registered workspace.'],
      ['list_inboxes', 'List enabled Runlet Inboxes, including readiness, exact table names, paths, row counts, and pending files. Use this before processing Inbox files.'],
      ['get_inbox', 'Inspect one configured Inbox, including its instructions, exact table name, readiness, paths, and pending files.'],
      ['update_inbox_instructions', 'Create or replace the instructions for one configured Inbox.'],
      ['read_file', 'Read a UTF-8 text file inside a registered workspace.'],
      ['write_file', 'Create or replace a UTF-8 text file inside a registered workspace.'],
      ['create_directory', 'Create a folder inside a registered workspace.'],
      ['move_file', 'Rename or move a file or folder inside the same workspace.'],
      ['delete_file', 'Delete a file or folder inside a workspace. Never deletes the workspace root.'],
    ],
  },
  {
    name: 'Data',
    tools: [
      ['list_data_tables', 'List Inbox-backed and standalone Tables, including each exact table_name, source kind, columns, and row count.'],
      ['create_data_table', 'Create an editable user table in a registered workspace.'],
      ['delete_data_table', 'Permanently delete a standalone user Table and all of its rows. Never deletes an Inbox table.'],
      ['get_data_table', 'Read a page of rows and column metadata from an exact workspace table_name; returned row IDs support later edits.'],
      ['write_data_rows', 'Insert many rows, or update matching rows using keyColumns. New columns are added automatically with an inferred internal SQLite type.'],
      ['update_data_cell', 'Edit one cell using the row id returned by get_data_table.'],
      ['delete_data_row', 'Delete one row using the row id returned by get_data_table.'],
      ['add_data_column', 'Add a text column to a workspace data table.'],
      ['rename_data_column', 'Rename a column without changing its values.'],
      ['delete_data_column', 'Permanently delete a column and all of its values.'],
      ['move_data_column', 'Move a column left or right in the table’s display order.'],
    ],
  },
  {
    name: 'Apps',
    tools: [
      ['list_apps', 'List Apps in a workspace, including controls, results, inputs, outputs, and custom-page availability.'],
      ['get_app', 'Read one App’s metadata and instructions.'],
      ['get_app_template', 'Get the authoritative portable App structure and rules. Always call before create_app.'],
      ['create_app', 'Create a validated local App with a generated interface or a richer browser page. Creates inputs/ and outputs/ automatically.'],
      ['run_app', 'Run an App and return its logs. Inspect its declared results and output files before reporting completion.'],
      ['get_app_run_history', 'Read the 50 most recent successful and failed runs for an App, including timestamps, durations, logs, final errors, and technical details.'],
      ['get_app_results', 'Read the App outputs declared as summary, text, or table result panels.'],
      ['update_app_metadata', 'Change an App’s display name or description without renaming its folder.'],
      ['delete_app', 'Permanently delete an App and its inputs, outputs, and run history. Use only when the user explicitly asks.'],
      ['read_app_input', 'Read a binary or text App input as an embedded resource.'],
      ['write_app_input', 'Add or replace an App input using UTF-8 text or base64 binary data.'],
      ['write_app_output', 'Write UTF-8 text or base64 binary data beneath an App outputs/ directory.'],
    ],
  },
  {
    name: 'Prompts',
    tools: [
      ['list_prompts', 'List reusable Prompts in a workspace.'],
      ['get_prompt', 'Get a saved Prompt. When the user asks to use it, follow the returned content with their attached or named files.'],
      ['get_prompt_template', 'Get the authoritative Prompt structure and authoring rules. Always call before create_prompt.'],
      ['create_prompt', 'Create a reusable provider-neutral Prompt in a workspace.'],
      ['update_prompt', 'Replace the content of an existing Prompt.'],
      ['update_prompt_metadata', 'Change a Prompt’s display name or description without changing its instructions or folder name.'],
      ['delete_prompt', 'Permanently delete a Prompt. Use only when the user explicitly asks.'],
    ],
  },
];

export const mcpToolDescriptions = Object.fromEntries(
  mcpToolGroups.flatMap((group) => group.tools),
);

export function formatMcpTools() {
  const width = Math.max(...mcpToolGroups.flatMap((group) => group.tools.map(([name]) => name.length)));
  const sections = mcpToolGroups.map((group) => `${group.name}\n${group.tools
    .map(([name, description]) => `  ${name.padEnd(width)}  ${description}`)
    .join('\n')}`);
  return `Runlet tools provided to connected AI apps\n\n${sections.join('\n\n')}\n\nThese tools can access only explicitly registered Runlet workspaces.\nRun \u201crunlet libraries\u201d to see the APIs available inside App JavaScript.`;
}
