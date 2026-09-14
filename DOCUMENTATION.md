# Runlet documentation

Runlet is a local workspace, App, and Prompt manager. It keeps normal pages simple while leaving workspace files available when someone intentionally wants to inspect them.

## Installation and updates

The installers include Runlet and its JavaScript runtime. Node.js, npm, Python, and Git are not required on the destination computer.

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/vijja-w/runlet/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/vijja-w/runlet/main/install.ps1 | iex
```

Check for and install a published update with:

```bash
runlet update
```

Running the one-line installer again also updates Runlet while preserving workspace folders and registrations.

Installed copies keep their local registry under `~/.local/state/runlet` on macOS and Linux, and `%LOCALAPPDATA%\Runlet\state` on Windows. Development checkouts use `.runlet/`.

## Commands

- `runlet` starts Runlet or opens the already-running copy.
- `runlet status` reports whether Runlet is running.
- `runlet version` prints the installed version.
- `runlet update` installs the latest published release when needed.
- `runlet tools` lists the workspace tools provided to connected AI apps.
- `runlet libraries` lists the APIs available to App JavaScript.
- `runlet kill` stops Runlet.
- `runlet open` starts or opens Runlet.
- `runlet uninstall` removes the app but keeps workspace folders and settings.

## Workspaces

A workspace is an ordinary folder explicitly registered with Runlet. Removing its registration never deletes the folder.

A workspace may contain normal files plus Apps and Prompts:

```text
apps/
└── my-app/
    ├── runlet.json
    ├── README.md
    ├── run.js
    ├── inputs/
    ├── outputs/
    └── index.html      # optional

prompts/
└── extract-invoice/
    ├── runlet.json
    └── PROMPT.md
```

The Files area lets someone intentionally inspect workspace files and enable ordinary folders as Inboxes. Files can be dragged from the computer or from another Runlet folder onto a folder to copy them there; the original stays where it is. App and Prompt pages keep paths and implementation details out of the normal workflow.

## Inboxes

An Inbox is an explicitly enabled folder whose loose files are waiting for a connected AI to process. Turning on Inbox for the first time creates or adopts this structure without replacing existing files:

```text
runlet.json
INSTRUCTIONS.md
processed/
needs-review/
```

`runlet.json` identifies the folder as an Inbox. `INSTRUCTIONS.md` tells the AI what to do. The Inbox's extracted records live in a table in the workspace database. Successful source files belong in `processed/`; files requiring human judgment belong in `needs-review/`.

The **Inbox Data** area first shows a searchable list of Inboxes. Open one to see its spreadsheet. You can edit cells, sort or search rows, add and remove rows or columns, rename or move columns, and paste a block copied from Excel or CSV. Column types remain an internal detail for now. Runlet stores the tables together in a private SQLite database under `.runlet/`; that implementation detail stays out of the normal interface.

The separate **Tables** area uses the same spreadsheet interface for information someone creates themselves rather than information extracted by an Inbox. New Tables begin with one editable column. Table cards can be reordered, and rows and columns can be added from the table view or through a connected AI using Runlet. A column can be renamed, moved, or deleted from its three-dot menu. A standalone Table can be permanently deleted from its table view after confirmation; an Inbox table can only be removed with its Inbox folder.

When an older Inbox is opened for the first time, Runlet imports its `data.csv` into the table and moves the original file into a hidden backup folder. Deleting an Inbox folder also deletes its table. Removing the workspace from Runlet never deletes the workspace folder or its database.

Turning an Inbox off preserves all of its files but removes it from normal AI processing. If a required item is deleted, the Inbox remains enabled but pauses with a warning until it is repaired. Runlet's own `apps/` and `prompts/` areas cannot become Inboxes.

## Tools provided to AI apps

Runlet connects to compatible AI apps through MCP. It provides tools for registered workspaces, files and Inboxes, Inbox Data and standalone Tables, Apps, and Prompts. The AI can only access folders that have been explicitly registered as Runlet workspaces.

For Inboxes, the AI uses `list_inboxes` to discover enabled work, `get_inbox` to read one Inbox and its exact table name, and the Data tools to inspect or modify cells, rows, and columns. The same Data tools work with standalone Tables. They deliberately provide structured operations instead of exposing the SQLite file directly. The ordinary file tools move completed source files. This is what makes requests such as “Use Runlet to modify the invoices table” work without asking the user to manage the database directly.

To see the complete current list with a description of each tool, run:

```bash
runlet tools
```

This list is generated from the same descriptions used by Runlet's MCP server, so it shows the actual interface provided to connected AI apps. It is different from `runlet libraries`, which describes the limited APIs available to JavaScript while an App runs.

## Apps

An App is a portable local program. `runlet.json` defines its editable name, description, controls, and result panels. Every App opens on its own Runlet page, and Runlet generates the normal controls-and-results interface from that information.

Controls may be text fields, numbers, or dropdowns. A dropdown can load unique options from a workspace table column. Results may show an `outputs/` text file as a summary or an `outputs/` CSV file as a table.

An App may include `index.html` for a richer browser interface. **Open App** opens that page without requiring another run. Its HTML, CSS, JavaScript, and other assets should stay in the App folder and use relative URLs so the whole workspace works on another computer with Runlet installed. CDNs should be avoided unless genuinely necessary, and Apps should not depend on per-machine package installs or a separate server.

App JavaScript runs locally in an isolated worker and receives only Runlet's built-in APIs, including workspace table access and helpers for PDF, CSV, ZIP, Excel `.xlsx`, and Word `.docx` files. See [App JavaScript API and bundled libraries](APPS.md), or run:

```bash
runlet libraries
```

Each App folder should also have a short user-facing README:

```markdown
# Extract Invoices

Turn invoice PDFs into one CSV file.

## Before you run

- Add PDF files under Inputs.

## How to use

1. Add the invoice PDFs.
2. Run the App.
3. Open `outputs/invoices.csv`.

## Outputs

- `outputs/invoices.csv` — extracted invoice details.
```

Open an App and use its trash button to permanently delete the App together with its inputs, outputs, and run history.

Every successful and failed run is recorded in **Run history**. Each entry includes its timestamp, duration, `run.log()` and `console.log/info/warn/error()` messages, final error, and technical details when available. Runlet retains the newest 50 entries per App and bounds the size of individual entries so logs cannot grow forever.

## Prompts

A Prompt is a reusable set of instructions for an AI. Runlet stores and returns it; Runlet does not choose a provider or launch another AI.

A `PROMPT.md` should clearly name:

- the inputs, including files attached to the AI conversation;
- the work or transformation required;
- the expected output format or filename.

Example:

```markdown
# Extract Invoice

Read every invoice PDF attached to this conversation.

Extract invoice number, invoice date, company, and total.
Return one `invoices.csv` file with those exact column names.
```

Ask a connected AI: `Ask Runlet to use the “Extract Invoice” Prompt with the attached PDFs.`

Open a Prompt and use its trash button to permanently delete it.

## AI connections

Open **Connections** in Runlet to connect supported AI apps installed on the same computer.

- ChatGPT installs the bundled local Runlet plugin. Start a new task after connecting, then ask ChatGPT to use Runlet.
- Claude opens a local extension installer. Approve it in Claude, then ask Claude to use Runlet.

Runlet does not manage AI accounts or API keys. The AI app starts Runlet's local MCP server when it needs the tools.

For local ChatGPT development without the packaged plugin:

```bash
npm run setup:codex
```

## Manual installation

Download the matching archive and `SHA256SUMS` from [GitHub Releases](https://github.com/vijja-w/runlet/releases/latest):

- `runlet-darwin-arm64.tar.gz` — macOS Apple Silicon
- `runlet-darwin-x64.tar.gz` — macOS Intel
- `runlet-linux-x64.tar.gz` — Linux x64
- `runlet-windows-x64.zip` — Windows x64

Verify the archive, extract it, and place the `runlet` folder somewhere permanent. The automatic installers use `~/.local/share/runlet` on macOS and Linux and `%LOCALAPPDATA%\Programs\Runlet` on Windows.

## Local architecture

- `bin/runlet.mjs` — background service and command-line commands
- `src/server.mjs` — local HTTP server and browser API
- `src/mcp-server.mjs` — provider-neutral MCP interface
- `src/workspaces.mjs` — workspace, App, and Prompt operations
- `src/app-worker.mjs` — isolated App worker
- `public/` — browser interface
