# Runlet

Runlet is a small local workspace manager. It keeps ordinary files, local Scripts, and reusable AI Prompts together without exposing technical details in the normal interface.

## Installation

Runlet is currently distributed as a self-contained command-line app. You do not need Node.js, npm, Python, or Git.

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/vijja-w/runlet/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/vijja-w/runlet/main/install.ps1 | iex
```

Run the same one-line command again whenever you want to update Runlet to the latest release. Your workspace folders and registrations are kept.

Then start Runlet:

```bash
runlet
```

Runlet continues in the background after the terminal closes and opens at `http://127.0.0.1:4173`.

Useful commands:

```bash
runlet status
runlet version
runlet kill
runlet open
```

Running `runlet` again opens the existing Runlet service instead of starting another copy.

Uninstall the app with:

```bash
runlet uninstall
```

Uninstalling keeps your workspace folders and Runlet settings. On Windows, open a new PowerShell window afterward so it picks up the updated PATH.

To install manually, download the matching archive and `SHA256SUMS` from [GitHub Releases](https://github.com/vijja-w/runlet/releases/latest):

- `runlet-darwin-arm64.tar.gz` — macOS Apple Silicon
- `runlet-darwin-x64.tar.gz` — macOS Intel
- `runlet-linux-x64.tar.gz` — Linux x64
- `runlet-windows-x64.zip` — Windows x64

Verify the archive, extract it, and place its `runlet` folder somewhere permanent. The automatic installers use `~/.local/share/runlet` on macOS/Linux and `%LOCALAPPDATA%\Programs\Runlet` on Windows.

This is Runlet’s pre-desktop-app distribution method. A future desktop wrapper can use the same local runtime.

## Local development

Development requires Node.js 22.13 or newer:

```bash
npm install
npm start
```

To make the `runlet` command use your development checkout, run `npm link`.

## Use with Codex

The Runlet plugin supplies the local MCP connection. After installing it, start a new Codex task and ask:

```text
@Runlet list my workspaces.
```

For local development without the plugin, connect the MCP server once:

```bash
npm run setup:codex
```

Runlet uses a local stdio MCP server. It does not need to be published or exposed to the internet.

## AI connections

Open **Connections** in Runlet to connect supported AI apps installed on the same computer.

- Codex installs the bundled local Runlet plugin. Start a new task and use `@Runlet`.
- Claude Desktop opens a small local extension installer. Approve it in Claude, then ask Claude to use Runlet.
- Claude Code installs the bundled local Runlet plugin. Restart Claude Code or reload plugins, then use `/runlet:use`.

Runlet does not manage AI accounts or API keys. Each AI app starts Runlet's local MCP process when it needs the tools.

## Workspaces

A workspace is an ordinary folder you explicitly add to Runlet. Removing its registration never deletes the folder.

Installed copies keep their local registry under the user data directory (`~/.local/state/runlet` on macOS/Linux and `%LOCALAPPDATA%\Runlet\state` on Windows). Development checkouts use `.runlet/`. Existing registrations from the earlier `.workshop/` location are read automatically.

Each workspace can contain ordinary files, Scripts, and Prompts:

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

## Scripts

A Script is a small local app. Runlet uses `runlet.json` to generate its controls and result panels, so a person can choose values, select Run, and review the result without seeing code. A specialized Script may also provide its own `index.html`.

Open always shows the Script’s Run page. After a specialized Script runs, its custom page opens in a separate browser tab while Runlet stays open.

Open a Script and use the trash button to permanently delete it together with its inputs and outputs.

The JavaScript runs locally in an isolated worker, not in the browser page. It uses only Runlet's built-in APIs, so each Script does not need packages or a separate installation. Its `run.js` exports one default function:

```js
export default async function ({ workspace, run, input }) {
  run.log('Reading the source file');
  const source = await workspace.read('scripts/copy-file/inputs/source.txt');
  await workspace.mkdir('scripts/copy-file/outputs');
  await workspace.write('scripts/copy-file/outputs/result.txt', source);
}
```

`input` contains values from the Script controls. Controls can be text fields, numbers, or dropdowns. A dropdown can load its options from a CSV column in the workspace. Result panels can show a text summary or CSV table from the Script's `outputs/` folder.

Available APIs:

- `workspace.read(path)`
- `workspace.readBytes(path)`
- `workspace.write(path, data)`
- `workspace.writeBytes(path, data)`
- `workspace.list(path)`
- `workspace.exists(path)`
- `workspace.mkdir(path)`
- `workspace.delete(path)`
- `workspace.fetch(httpsUrl, options)`
- `run.log(message)`

Runlet also bundles a small standard library for common file work:

- `pdf.extractText(bytes)` extracts text from a text-based PDF.
- `csv.parse(text, options)` reads CSV into rows.
- `csv.stringify(rows, options)` creates valid CSV text.
- `zip.extract(bytes)` reads a ZIP archive into files.
- `zip.create(files, options)` creates a ZIP archive.

Use `workspace.readBytes()` and `workspace.writeBytes()` with PDFs, ZIP archives, and other binary files. Scripts receive the helpers they need in their function arguments:

```js
export default async function ({ workspace, run, pdf, csv }) {
  const source = await workspace.readBytes('scripts/invoice-import/inputs/invoice.pdf');
  const text = await pdf.extractText(source);
  const output = csv.stringify([['source', 'text'], ['invoice.pdf', text]]);
  await workspace.write('scripts/invoice-import/outputs/invoices.csv', output);
  run.log('Created invoices.csv');
}
```

PDF text extraction does not perform OCR. Scanned image-only PDFs need a separate OCR capability.

Paths are relative to the registered workspace. Scripts have a 30-second limit and a 128 MB worker memory limit.

## Prompts

A Prompt is a reusable set of instructions for an AI. Runlet stores it and makes it available to Codex or another MCP-capable AI. It does not choose a provider or launch a second agent.

Open a Prompt and use the trash button to permanently delete it.

Its `PROMPT.md` should name:

- the inputs to read, including files attached directly to the AI conversation;
- the fields or transformation required;
- the desired output format or filename.

Example:

```markdown
# Extract Invoice

Read every invoice PDF attached to this conversation.

Extract invoice number, invoice date, company, and total.
Return one `invoices.csv` file with those exact column names.
```

Ask an MCP-capable AI:

```text
@Runlet use the “Extract Invoice” Prompt with the attached PDFs.
```

Runlet returns the saved Prompt. The AI follows it using the files in the conversation or workspace.

## Script README format

The README is the Script’s user interface. Keep it short and concrete:

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

Runlet normally builds the interactive page from `runlet.json`. Add `index.html` only for a specialized dashboard that the generated controls and result panels cannot express. It should read relative files from `outputs/`.

## Local architecture

- `bin/runlet.mjs` — background service commands
- `src/server.mjs` — local HTTP server and browser API
- `src/mcp-server.mjs` — provider-neutral MCP interface
- `src/workspaces.mjs` — workspace, Script, and Prompt operations
- `src/action-worker.mjs` — isolated Script worker
- `public/` — minimal browser interface
