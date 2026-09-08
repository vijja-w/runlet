# Runlet documentation

Runlet is a local workspace, Script, and Prompt manager. It keeps normal pages simple while leaving workspace files available when someone intentionally wants to inspect them.

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
- `runlet libraries` lists the APIs available to Script JavaScript.
- `runlet kill` stops Runlet.
- `runlet open` starts or opens Runlet.
- `runlet uninstall` removes the app but keeps workspace folders and settings.

## Workspaces

A workspace is an ordinary folder explicitly registered with Runlet. Removing its registration never deletes the folder.

A workspace may contain normal files plus Scripts and Prompts:

```text
scripts/
└── my-script/
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

The Files area lets someone intentionally inspect workspace files. Script and Prompt pages keep paths and implementation details out of the normal workflow.

## Scripts

A Script is a small local app. `runlet.json` defines its editable name, description, controls, and result panels. Runlet generates the normal Run page from that information.

Controls may be text fields, numbers, or dropdowns. A dropdown can load unique options from a CSV column in the workspace. Results may show an `outputs/` text file as a summary or an `outputs/` CSV file as a table.

A specialized Script may include `index.html`. After the Script runs, that page opens in a separate browser tab. **Previous run** reopens it without running the Script again.

Script JavaScript runs locally in an isolated worker and receives only Runlet's built-in APIs, including helpers for PDF, CSV, ZIP, Excel `.xlsx`, and Word `.docx` files. See [Script JavaScript API and bundled libraries](SCRIPTING.md), or run:

```bash
runlet libraries
```

Each Script folder should also have a short user-facing README:

```markdown
# Extract Invoices

Turn invoice PDFs into one CSV file.

## Before you run

- Add PDF files under Inputs.

## How to use

1. Add the invoice PDFs.
2. Run the Script.
3. Open `outputs/invoices.csv`.

## Outputs

- `outputs/invoices.csv` — extracted invoice details.
```

Open a Script and use its trash button to permanently delete the Script together with its inputs and outputs.

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
- `src/workspaces.mjs` — workspace, Script, and Prompt operations
- `src/action-worker.mjs` — isolated Script worker
- `public/` — browser interface
