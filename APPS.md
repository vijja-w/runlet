# Runlet App JavaScript API

This is the complete API available to an App's `run.js`. Runlet bundles these capabilities with every installation; individual Apps do not install packages.

For a short list from any installed copy, run:

```bash
runlet libraries
```

## App entry point

`run.js` exports one default async function:

```js
export default async function ({ workspace, run, input, data, pdf, csv, zip, xlsx, docx }) {
  run.log('Starting');
}
```

- `workspace` reads and changes files inside the registered workspace.
- `run` writes messages to the Runlet run log.
- `input` contains values from controls declared in `runlet.json`.
- `data` reads and updates the workspace's Inbox tables.
- `pdf`, `csv`, `zip`, `xlsx`, and `docx` are bundled file helpers.

Apps cannot use `import`, `require`, Node.js filesystem APIs, `process`, child processes, shell commands, native binaries, installed npm packages, secrets, or paths outside the registered workspace.

## Workspace API

All paths are relative to the registered workspace. Attempts to leave it with absolute paths or `..` are rejected.

### Text files

- `await workspace.read(path)` returns a UTF-8 string.
- `await workspace.write(path, data)` writes a string, bytes, or JSON-serializable value. Missing parent folders are created automatically.

```js
const source = await workspace.read('apps/example/inputs/source.txt');
await workspace.write('apps/example/outputs/result.txt', source.toUpperCase());
```

### Binary files

- `await workspace.readBytes(path)` returns a `Uint8Array`.
- `await workspace.writeBytes(path, data)` writes an `ArrayBuffer`, typed-array view, or `Uint8Array`. Missing parent folders are created automatically.

Use these for PDFs, ZIP archives, images, and other binary files.

### Folders and files

- `await workspace.list(path)` returns direct children as `{ name, type }`, where `type` is `file` or `directory`.
- `await workspace.exists(path)` returns `true` or `false`.
- `await workspace.mkdir(path)` creates the folder and any missing parents.
- `await workspace.delete(path)` recursively deletes the named file or folder.

### HTTPS requests

- `await workspace.fetch(httpsUrl, options)` performs an HTTPS request.
- The request has a 10-second timeout.
- The response provides `ok`, `status`, `await response.text()`, and `await response.json()`.
- Plain HTTP URLs are rejected.

```js
const response = await workspace.fetch('https://example.com/data.json');
if (!response.ok) throw new Error(`Request failed: ${response.status}`);
const data = await response.json();
```

## Run log

- `run.log(message)` adds a message to the completed run.
- `console.log(...)`, `console.info(...)`, `console.warn(...)`, and `console.error(...)` also write readable messages to the run log.
- Runlet keeps the 50 most recent successful and failed runs for each App.
- Each saved run includes its time, duration, log messages, and final error when one occurs.
- Run history is size-limited and stored in a hidden Runlet-managed folder inside the App.

## Workspace data tables

Every Inbox has a table in the workspace database. Use `data` when an App needs those records. The table name is shown in Runlet's Data area and is also returned when the Inbox is inspected.

- `await data.listTables()` returns the available tables and their columns.
- `await data.read(table, options)` returns rows as plain objects. `options` may include `limit` and `offset`.
- `await data.insert(table, rows)` adds one row object or an array of row objects.
- `await data.upsert(table, rows, keyColumns)` inserts new rows and updates matching rows. `keyColumns` is an array of column names that identifies an existing row.

New columns are added automatically when `insert` or `upsert` receives a field that is not yet in the table.

```js
const prices = await data.read('invoices');
await data.upsert('invoices', {
  source_file: 'invoice-104.pdf',
  ingredient: 'Bread Flour',
  price_usd: 12.20,
}, ['source_file', 'ingredient']);
run.log(`The table now has ${prices.length + 1} rows`);
```

## PDF helper

- `await pdf.extractText(bytes)` extracts text from every page of a text-based PDF.
- Pass bytes returned by `workspace.readBytes()`.
- It does not perform OCR. Image-only scanned PDFs require a separate OCR service or AI workflow.

```js
const source = await workspace.readBytes('apps/invoices/inputs/invoice.pdf');
const text = await pdf.extractText(source);
await workspace.write('apps/invoices/outputs/invoice.txt', text);
```

## CSV helpers

- `csv.parse(text, options)` parses CSV text into rows.
- `csv.stringify(records, options)` creates valid CSV text.

Common examples:

```js
const rows = csv.parse(source, { columns: true, skip_empty_lines: true });
const output = csv.stringify(rows, { header: true });
```

The helpers use the bundled `csv-parse` and `csv-stringify` libraries.

## ZIP helpers

- `zip.extract(bytes)` returns an object keyed by archive filename. Each value is a `Uint8Array`.
- `zip.create(files, options)` returns a ZIP archive as a `Uint8Array`.
- `files` is an object whose keys are archive filenames and whose values are strings or binary data.

```js
const archive = zip.create({
  'summary.txt': 'Complete',
  'results.csv': csv.stringify([['name', 'value'], ['Example', '1']]),
});
await workspace.writeBytes('apps/example/outputs/results.zip', archive);
```

The ZIP helper uses the bundled `fflate` library.

## Excel helper

- `await xlsx.read(bytes)` reads an `.xlsx` workbook.
- It returns `{ sheets }`. Each sheet is `{ name, rows }`, and `rows` is an array of row arrays.
- Numbers and booleans remain typed. Dates become ISO strings. Formula cells return their saved result when available.
- `await xlsx.create(sheets)` creates an `.xlsx` workbook as a `Uint8Array`.
- `sheets` is an object keyed by sheet name, with an array of row arrays for each value.

```js
const workbook = await xlsx.create({
  Prices: [
    ['ingredient', 'price'],
    ['Walnuts', 46.17],
  ],
});
await workspace.writeBytes('apps/example/outputs/prices.xlsx', workbook);

const source = await workspace.readBytes('apps/example/inputs/source.xlsx');
const data = await xlsx.read(source);
run.log(`Read ${data.sheets.length} sheets`);
```

The Excel helper uses the bundled `exceljs` library. It intentionally exposes rows rather than ExcelJS objects, keeping App data portable and safe.

## Word helper

- `await docx.extractText(bytes)` extracts the readable text from a `.docx` Word document.
- Pass bytes returned by `workspace.readBytes()`.
- Paragraphs are separated by blank lines.
- Formatting, images, comments, and tracked-change details are not preserved.

```js
const source = await workspace.readBytes('apps/example/inputs/report.docx');
const text = await docx.extractText(source);
await workspace.write('apps/example/outputs/report.txt', text);
```

The Word helper uses the bundled `mammoth` library.

## Safe JavaScript globals

App code can use:

- standard JavaScript language features supported by Runlet's bundled runtime;
- `console.log`, `console.info`, `console.warn`, and `console.error`;
- `setTimeout` and `clearTimeout`;
- `TextEncoder` and `TextDecoder`;
- `URL`.

Dynamic string code generation and WebAssembly compilation are disabled.

## Limits

- An App run has a 30-second time limit.
- The worker has a 128 MB old-generation and 32 MB young-generation memory limit.
- Generated files should be written beneath that App's `outputs/` folder.
- User-supplied source files should be kept beneath `inputs/` or another explicitly named workspace path.

## Complete example

```js
export default async function ({ workspace, run, data, pdf }) {
  const source = await workspace.readBytes('apps/invoice-import/inputs/invoice.pdf');
  const text = await pdf.extractText(source);
  await data.upsert('invoices', { source_file: 'invoice.pdf', text }, ['source_file']);
  run.log('Saved invoice.pdf to the invoices table');
}
```
