# Instructions for AI agents

This repository builds Runlet, a local workspace, App, and Prompt manager for people who do not code.

## Product principle

The interface should feel like a file cabinet plus small programs with Run buttons and saved Prompts with Copy buttons. Keep source, folder paths, and technical details out of the default App view; the separate Files area and collapsed Run history are available when someone intentionally wants to inspect them. Do not add a terminal, code editor, debugger, Git UI, package manager, visual workflow builder, setup wizard, unnecessary disclosure, or unnecessary modal.

## Workspaces

Use the Runlet MCP tools for user workspace operations. List workspaces first when the intended folder is ambiguous. Select the named workspace before editing it. If the user names a workspace that does not exist, create or register that folder with `create_workspace` before continuing.

Never modify a folder that has not been registered as a Runlet workspace.

## Creating an App

When asked to create or update an App:

1. Inspect the selected workspace’s relevant files.
2. Call `get_app_template`.
3. Create `apps/<kebab-case-name>/runlet.json` with its editable name, description, controls, and result panels.
4. Create `apps/<kebab-case-name>/run.js`.
5. Create `apps/<kebab-case-name>/README.md` using the README contract in the root `README.md`.
6. Use `inputs/` for user-supplied source files and write generated files only beneath that App’s `outputs/` directory.
7. Use Runlet's generated interface for simple controls and results. Add `index.html` when a richer browser interface is materially better. Keep its assets local, use relative URLs, and avoid CDNs unless genuinely necessary.
8. Keep the App portable: do not rely on machine-specific paths, per-App installs, native binaries, or a separate server.
9. Use `run.log()` or `console.log()` for concise diagnostic messages. Runlet keeps the 50 most recent successful and failed runs.
10. Run the App with `run_app`, inspect its declared results, output files, and run history, and fix failures before reporting completion.

App code is JavaScript-only. It receives `{ workspace, run, input, data, pdf, csv, zip, xlsx, docx }`, where `input` contains values from declared controls. Use the provided file and data APIs plus Runlet's bundled file helpers. Binary files use `workspace.readBytes` and `workspace.writeBytes`. Do not use Node.js filesystem APIs, child processes, shell commands, native binaries, dependency installation, secrets, or paths outside the workspace.

## Creating a Prompt

When asked to create or update a Prompt:

1. Inspect the selected workspace and call `get_prompt_template`.
2. Store its editable name and description at `prompts/<kebab-case-name>/runlet.json`.
3. Store its instructions at `prompts/<kebab-case-name>/PROMPT.md`.
4. Begin with a clear title and short description.
5. State the inputs, work, and expected output clearly. Inputs may be files attached directly to the AI conversation.

Runlet stores and returns Prompts. It does not select an AI provider or launch a nested agent.

## README voice

Keep each App README as short, plain-language usage documentation. The visible App interface comes from `runlet.json`. Use short sentences, numbered steps, exact filenames, and plain-language output descriptions. Assume the reader does not understand code, packages, or command lines.

## Local architecture constraints

- The GUI and MCP server share `src/workspaces.mjs`.
- Only explicitly registered workspace roots may be accessed.
- Resolve and validate every relative path against its workspace root.
- Removing a workspace registration must never delete its folder.
- Apps run in worker threads with a time and memory limit.
- Keep the normal start command as `npm start`.
