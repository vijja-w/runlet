# Instructions for AI agents

This repository builds Runlet, a local workspace, Script, and Prompt manager for people who do not code.

## Product principle

The interface should feel like a file cabinet plus small programs with Run buttons and saved Prompts with Copy buttons. Keep source, logs, folder paths, and other technical details off normal Script pages; the separate Files area is available when someone intentionally wants to inspect files. Do not add a terminal, code editor, debugger, Git UI, package manager, visual workflow builder, setup wizard, unnecessary disclosure, or unnecessary modal.

## Workspaces

Use the Runlet MCP tools for user workspace operations. List workspaces first when the intended folder is ambiguous. Select the named workspace before editing it. If the user names a workspace that does not exist, create or register that folder with `create_workspace` before continuing.

Never modify a folder that has not been registered as a Runlet workspace.

## Creating a Script

When asked to create or update a Script:

1. Inspect the selected workspace’s relevant files.
2. Call `get_script_template`.
3. Create `scripts/<kebab-case-name>/runlet.json` with its editable name, description, controls, and result panels.
4. Create `scripts/<kebab-case-name>/run.js`.
5. Create `scripts/<kebab-case-name>/README.md` using the README contract in the root `README.md`.
6. Use `inputs/` for user-supplied source files and write generated files only beneath that Script’s `outputs/` directory.
7. Prefer Runlet's generated small-app interface. Add `index.html` only when a specialized interactive page is materially better. It should read relative files from `outputs/` and work when opened by Runlet.
8. Run the Script with `run_script`, inspect its declared results and output files, and fix failures before reporting completion.

Script code is JavaScript-only. It receives `{ workspace, run, input }`, where `input` contains values from declared controls. Use the provided `workspace` and `run` APIs. Do not use Node.js filesystem APIs, child processes, shell commands, native binaries, dependency installation, secrets, or paths outside the workspace.

## Creating a Prompt

When asked to create or update a Prompt:

1. Inspect the selected workspace and call `get_prompt_template`.
2. Store its editable name and description at `prompts/<kebab-case-name>/runlet.json`.
3. Store its instructions at `prompts/<kebab-case-name>/PROMPT.md`.
4. Begin with a clear title and short description.
5. State the inputs, work, and expected output clearly. Inputs may be files attached directly to the AI conversation.

Runlet stores and returns Prompts. It does not select an AI provider or launch a nested agent.

## README voice

Keep each Script README as short, plain-language usage documentation. The visible Script interface comes from `runlet.json`. Use short sentences, numbered steps, exact filenames, and plain-language output descriptions. Assume the reader does not understand code, packages, or command lines.

## Local architecture constraints

- The GUI and MCP server share `src/workspaces.mjs`.
- Only explicitly registered workspace roots may be accessed.
- Resolve and validate every relative path against its workspace root.
- Removing a workspace registration must never delete its folder.
- Scripts run in worker threads with a time and memory limit.
- Keep the normal start command as `npm start`.
