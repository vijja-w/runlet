import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const execFileAsync = promisify(execFile);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runlet-test-'));
process.env.RUNLET_STATE_DIR = path.join(temporaryRoot, 'state');
const runlet = await import('../src/workspaces.mjs');
const connections = await import('../src/connections.mjs');
const { mcpToolGroups } = await import('../src/mcp-tools.mjs');

function simplePdf(text) {
  const escaped = String(text).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'ascii');
}

function simpleDocx(text) {
  const escaped = String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`),
  }));
}

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('creates a workspace with separate Apps and Prompts folders', async () => {
  const workspace = await runlet.createWorkspace({ name: 'Test', folderPath: path.join(temporaryRoot, 'workspace'), create: true });
  assert.equal((await runlet.getCurrentWorkspace()).id, workspace.id);
  assert.equal((await fs.stat(path.join(workspace.path, 'apps'))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(workspace.path, 'prompts'))).isDirectory(), true);
  assert.ok((await fs.stat(path.join(workspace.path, '.runlet', 'workspace.sqlite'))).isFile());
  const template = runlet.getAppTemplate(true);
  assert.ok(template.structure.includes('index.html'));
  assert.match(template.rules.join(' '), /portable to another Runlet installation/);
  assert.match(template.rules.join(' '), /50 most recent successful and failed runs/);
});

test('creates folders and safely moves files within a workspace', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.makeDirectory(current.id, 'Documents');
  await runlet.writeFile(current.id, 'note.txt', 'hello');
  await runlet.moveFile(current.id, 'note.txt', 'Documents/note.txt');
  assert.deepEqual((await runlet.listFiles(current.id, 'Documents')).map((item) => item.name), ['note.txt']);
  await assert.rejects(runlet.makeDirectory(current.id, 'Documents'), /already exists/i);
  await assert.rejects(runlet.moveFile(current.id, 'Documents', 'Documents/Archive/Documents'), /into itself/i);
  await assert.rejects(runlet.moveFile(current.id, 'Documents/note.txt', 'Documents/note.txt'), /into itself/i);
  await runlet.copyFile(current.id, 'Documents/note.txt', 'note-copy.txt');
  assert.equal(await runlet.readFile(current.id, 'note-copy.txt'), 'hello');
  await runlet.uploadFiles(current.id, 'Documents', [{ name: 'dropped.txt', data: Buffer.from('copied') }]);
  assert.equal(await runlet.readFile(current.id, 'Documents/dropped.txt'), 'copied');
  await runlet.writeFileEncoded(current.id, 'Documents/binary.bin', 'AAEC/w==', 'base64');
  assert.equal(await runlet.readFileEncoded(current.id, 'Documents/binary.bin', 'base64'), 'AAEC/w==');
  await assert.rejects(runlet.writeFileEncoded(current.id, 'Documents/invalid.bin', 'not base64!', 'base64'), /valid base64/i);
  await runlet.deleteFile(current.id, 'note-copy.txt');
  await runlet.deleteFile(current.id, 'Documents');
});

test('configures, pauses, repairs, and discovers Inboxes safely', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.makeDirectory(current.id, 'Invoices');
  await runlet.writeFile(current.id, 'Invoices/invoice-1.txt', 'Invoice 1');

  const ready = await runlet.setupInbox(current.id, 'Invoices');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.enabled, true);
  const inboxConfig = JSON.parse(await runlet.readFile(current.id, 'Invoices/runlet.json'));
  assert.equal(inboxConfig.kind, 'inbox');
  assert.equal(inboxConfig.version, 2);
  assert.equal(inboxConfig.data, undefined);
  assert.equal(typeof inboxConfig.table, 'string');
  assert.deepEqual((await runlet.getDataTable(current.id, inboxConfig.table)).columns, [{ name: 'source_file', type: 'TEXT' }]);
  assert.deepEqual((await runlet.listDataTables(current.id)).map((table) => table.display_name), ['Invoices']);

  await runlet.writeDataRows(current.id, inboxConfig.table, [
    { source_file: 'invoice-1.txt', vendor: 'Bakery Supply', total: 12.5 },
  ], ['source_file']);
  await runlet.writeDataRows(current.id, inboxConfig.table, [
    { source_file: 'invoice-1.txt', vendor: 'Bakery Supply', total: 13.25 },
  ], ['source_file']);
  let data = await runlet.getDataTable(current.id, inboxConfig.table);
  assert.equal(data.rowCount, 1);
  assert.equal(data.rows[0].values.total, 13.25);
  await runlet.updateDataCell(current.id, inboxConfig.table, data.rows[0].id, 'vendor', 'New Supplier');
  assert.equal((await runlet.getDataTable(current.id, inboxConfig.table)).rows[0].values.vendor, 'New Supplier');
  const added = await runlet.addDataRow(current.id, inboxConfig.table, { source_file: 'manual' });
  await runlet.deleteDataRow(current.id, inboxConfig.table, added.rowId);
  assert.equal((await runlet.getDataTable(current.id, inboxConfig.table)).rowCount, 1);
  await runlet.addDataColumn(current.id, inboxConfig.table, 'notes');
  await runlet.moveDataColumn(current.id, inboxConfig.table, 'notes', 'left');
  assert.deepEqual((await runlet.getDataTable(current.id, inboxConfig.table)).columns.map((column) => column.name), ['source_file', 'vendor', 'notes', 'total']);
  await runlet.renameDataColumn(current.id, inboxConfig.table, 'notes', 'comments');
  assert.deepEqual((await runlet.getDataTable(current.id, inboxConfig.table)).columns.map((column) => column.name), ['source_file', 'vendor', 'comments', 'total']);
  await assert.rejects(runlet.renameDataColumn(current.id, inboxConfig.table, 'comments', 'vendor'), /already exists/i);
  await runlet.deleteDataColumn(current.id, inboxConfig.table, 'comments');
  assert.deepEqual((await runlet.getDataTable(current.id, inboxConfig.table)).columns.map((column) => column.name), ['source_file', 'vendor', 'total']);
  await runlet.makeDirectory(current.id, 'Invoices/processed/not-an-inbox');
  await runlet.writeFile(current.id, 'Invoices/processed/not-an-inbox/runlet.json', JSON.stringify({ kind: 'inbox' }));

  const discovered = await runlet.listInboxes(current.id);
  assert.deepEqual(discovered.map((inbox) => inbox.path), ['Invoices']);
  assert.deepEqual(discovered[0].pendingFiles, ['invoice-1.txt']);
  assert.equal(discovered[0].processedPath, path.join('Invoices', 'processed'));
  assert.equal(discovered[0].needsReviewPath, path.join('Invoices', 'needs-review'));

  const inbox = await runlet.getInbox(current.id, 'Invoices');
  assert.match(inbox.instructions, /Inbox instructions/);
  assert.equal(inbox.table, inboxConfig.table);
  const updated = await runlet.updateInboxInstructions(current.id, 'Invoices', '# Invoice instructions\n\nExtract the total.\n');
  assert.equal(updated.instructions, '# Invoice instructions\n\nExtract the total.\n');
  assert.equal(await runlet.readFile(current.id, 'Invoices/INSTRUCTIONS.md'), updated.instructions);
  await assert.rejects(runlet.getInbox(current.id, 'not-an-inbox'), /not found/i);
  await assert.rejects(runlet.updateInboxInstructions(current.id, 'apps', '# No'), /not an Inbox/i);

  await runlet.deleteFile(current.id, 'Invoices/INSTRUCTIONS.md');
  const listed = (await runlet.listFiles(current.id)).find((item) => item.name === 'Invoices');
  assert.equal(listed.inbox.status, 'attention');
  assert.equal(listed.inbox.repairable, true);

  await runlet.setInboxEnabled(current.id, 'Invoices', false);
  assert.deepEqual(await runlet.listInboxes(current.id), []);
  assert.equal((await runlet.listInboxes(current.id, { includeDisabled: true }))[0].enabled, false);
  await assert.rejects(runlet.setInboxEnabled(current.id, 'Invoices', true), /needs attention/i);

  const repaired = await runlet.setupInbox(current.id, 'Invoices', { repair: true });
  assert.equal(repaired.status, 'ready');
  await assert.rejects(runlet.setupInbox(current.id, 'apps'), /Apps and Prompts/i);
  await assert.rejects(runlet.setupInbox(current.id, 'Invoices/processed'), /result folders/i);
  await runlet.deleteFile(current.id, 'Invoices');
  assert.deepEqual(await runlet.listDataTables(current.id), []);
  await assert.rejects(runlet.getDataTable(current.id, inboxConfig.table), /not found/i);
});

test('creates standalone workspace Tables', async () => {
  const current = await runlet.getCurrentWorkspace();
  const created = await runlet.createDataTable(current.id, 'Suppliers');
  assert.equal(created.display_name, 'Suppliers');
  assert.equal(created.description, 'A table for organizing information.');
  assert.equal(created.source_kind, 'table');
  assert.equal(created.inbox_path, `.runlet/tables/${created.table_name}`);
  assert.deepEqual(created.columns, [{ name: 'Column 1', type: 'TEXT' }]);
  const row = await runlet.addDataRow(current.id, created.table_name, { 'Column 1': 'Golden Grain' });
  assert.equal(row.rowId, 1);
  assert.equal((await runlet.getDataTable(current.id, created.table_name)).rows[0].values['Column 1'], 'Golden Grain');
  await runlet.renameDataColumn(current.id, created.table_name, 'Column 1', 'Supplier');
  assert.equal((await runlet.getDataTable(current.id, created.table_name)).rows[0].values.Supplier, 'Golden Grain');
  await assert.rejects(runlet.createDataTable(current.id, 'suppliers'), /already exists/i);
  const renamed = await runlet.updateDataTableMetadata(current.id, created.table_name, { name: 'Preferred Suppliers', description: 'Vendors we buy from regularly.' });
  assert.equal(renamed.display_name, 'Preferred Suppliers');
  assert.equal(renamed.description, 'Vendors we buy from regularly.');
  const second = await runlet.createDataTable(current.id, 'Markets');
  const ordered = await runlet.reorderItems(current.id, 'tables', [second.table_name, created.table_name]);
  assert.deepEqual(ordered.filter((table) => table.source_kind === 'table').map((table) => table.display_name), ['Markets', 'Preferred Suppliers']);
  await runlet.deleteDataTable(current.id, created.table_name);
  await assert.rejects(runlet.getDataTable(current.id, created.table_name), /not found/i);
  await runlet.deleteDataTable(current.id, second.table_name);
});

test('migrates legacy Inbox CSV data into its workspace database', async () => {
  const previous = await runlet.getCurrentWorkspace();
  const folder = path.join(temporaryRoot, 'legacy-workspace');
  const legacy = await runlet.createWorkspace({ name: 'Legacy workspace', folderPath: folder, create: true });
  await fs.mkdir(path.join(folder, 'Orders', 'processed'), { recursive: true });
  await fs.mkdir(path.join(folder, 'Orders', 'needs-review'), { recursive: true });
  await fs.writeFile(path.join(folder, 'Orders', 'INSTRUCTIONS.md'), '# Orders\n');
  await fs.writeFile(path.join(folder, 'Orders', 'data.csv'), 'source_file,item,price\norder-1.csv,Bread,4.25\n');
  await fs.writeFile(path.join(folder, 'Orders', 'runlet.json'), JSON.stringify({
    kind: 'inbox', version: 1, enabled: true, instructions: 'INSTRUCTIONS.md', data: 'data.csv', processed: 'processed', needsReview: 'needs-review',
  }));

  const inbox = (await runlet.listInboxes(legacy.id))[0];
  assert.equal(inbox.rowCount, 1);
  const data = await runlet.getDataTable(legacy.id, inbox.table);
  assert.equal(data.rows[0].values.item, 'Bread');
  assert.equal(data.rows[0].values.price, 4.25);
  await assert.rejects(fs.access(path.join(folder, 'Orders', 'data.csv')));
  assert.ok((await fs.readdir(path.join(folder, '.runlet', 'backups'))).some((name) => name.startsWith(`${inbox.table}-data-`)));
  const config = JSON.parse(await fs.readFile(path.join(folder, 'Orders', 'runlet.json'), 'utf8'));
  assert.equal(config.version, 2);
  assert.equal(config.table, inbox.table);
  assert.equal(config.data, undefined);

  await runlet.removeWorkspace(legacy.id);
  await runlet.selectWorkspace(previous.id);
});

test('requires unique workspace names and renames without deleting folders', async () => {
  const first = await runlet.getCurrentWorkspace();
  const secondFolder = path.join(temporaryRoot, 'second-workspace');
  await fs.mkdir(secondFolder);
  await assert.rejects(
    runlet.createWorkspace({ name: 'test', folderPath: secondFolder }),
    /unique/i,
  );
  const second = await runlet.createWorkspace({ name: 'Second', folderPath: secondFolder });
  const renamed = await runlet.updateWorkspace(second.id, { name: 'Renamed' });
  assert.equal(renamed.name, 'Renamed');
  await assert.rejects(runlet.updateWorkspace(second.id, { name: first.name }), /unique/i);
  await runlet.removeWorkspace(second.id);
  assert.equal((await fs.stat(secondFolder)).isDirectory(), true);
  await runlet.selectWorkspace(first.id);
});

test('creates and runs an App with bounded success and failure logs', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.makeDirectory(current.id, 'Recipes');
  const recipeInbox = await runlet.setupInbox(current.id, 'Recipes');
  await runlet.writeDataRows(current.id, recipeInbox.table, [{ recipe: 'Sourdough' }, { recipe: 'Baguette' }, { recipe: 'Sourdough' }]);
  await runlet.createApp({
    workspaceId: current.id,
    slug: 'copy-text',
    name: 'Recipe Message',
    description: 'Write a message for one recipe.',
    controls: [
      { name: 'recipe', label: 'Recipe', type: 'select', required: true, source: { type: 'table-column', table: recipeInbox.table, column: 'recipe' } },
      { name: 'message', label: 'Message', type: 'text', required: true },
    ],
    results: [{ type: 'summary', label: 'Result', path: 'outputs/result.txt' }],
    readme: '# Copy Text\n\nCopy one input into an output.\n',
    indexHtml: '<!doctype html><title>Recipe Message</title><main>Recipe Message</main>',
    runJs: `export default async function ({ workspace, run, input, data }) {
      const recipes = await data.read('${recipeInbox.table}');
      if (!recipes.some((row) => row.recipe === input.recipe)) throw new Error('Recipe not found.');
      await workspace.write('apps/copy-text/outputs/result.txt', input.recipe + ': ' + input.message.toUpperCase());
      console.log('Preparing', { recipe: input.recipe });
      run.log('Created message.');
      if (input.message === 'fail') throw new Error('Deliberate failure.');
    }`,
  });
  const listed = await runlet.getApp(current.id, 'copy-text');
  assert.equal(listed.hasPage, true);
  assert.deepEqual(listed.controls[0].options, ['Baguette', 'Sourdough']);
  const result = await runlet.runApp(current.id, 'copy-text', { recipe: 'Sourdough', message: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.logs, ['Preparing {"recipe":"Sourdough"}', 'Created message.']);
  assert.equal(await runlet.readFile(current.id, 'apps/copy-text/outputs/result.txt'), 'Sourdough: HELLO');
  assert.equal((await runlet.getAppResults(current.id, 'copy-text'))[0].content, 'Sourdough: HELLO');

  let history = await runlet.getAppRunHistory(current.id, 'copy-text');
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'completed');
  assert.deepEqual(history[0].logs, ['Preparing {"recipe":"Sourdough"}', 'Created message.']);

  await assert.rejects(
    runlet.runApp(current.id, 'copy-text', { recipe: 'Sourdough', message: 'fail' }),
    /Deliberate failure/,
  );
  history = await runlet.getAppRunHistory(current.id, 'copy-text');
  assert.equal(history[0].status, 'failed');
  assert.equal(history[0].error, 'Deliberate failure.');
  assert.deepEqual(history[0].logs, ['Preparing {"recipe":"Sourdough"}', 'Created message.']);
  assert.match(history[0].details, /run\.js/);
  assert.equal((await runlet.listFiles(current.id, 'apps/copy-text')).some((item) => item.name === '.runlet'), false);

  for (let index = 0; index < 50; index += 1) {
    await runlet.runApp(current.id, 'copy-text', { recipe: 'Sourdough', message: `run-${index}` });
  }
  history = await runlet.getAppRunHistory(current.id, 'copy-text');
  assert.equal(history.length, 50);
  assert.ok(history.every((run) => run.status === 'completed'));

  const renamed = await runlet.updateAppMetadata(current.id, 'copy-text', { name: 'Recipe Note', description: 'Make a short recipe note.' });
  assert.equal(renamed.name, 'Recipe Note');

  const binary = Buffer.from([0, 1, 2, 255]);
  await runlet.writeAppOutput(current.id, 'copy-text', 'nested/result.bin', binary);
  assert.deepEqual(await fs.readFile(path.join(current.path, 'apps/copy-text/outputs/nested/result.bin')), binary);

  const deleted = await runlet.deleteApp(current.id, 'copy-text');
  assert.equal(deleted.deleted.name, 'Recipe Note');
  await assert.rejects(runlet.getApp(current.id, 'copy-text'), /App not found/);
  await assert.rejects(fs.access(path.join(current.path, 'apps/copy-text')));
  await runlet.deleteFile(current.id, 'Recipes');
});

test('Apps can extract PDF text and use bundled CSV and ZIP helpers', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.createApp({
    workspaceId: current.id,
    slug: 'document-tools',
    name: 'Document Tools',
    description: 'Exercise the bundled document helpers.',
    results: [{ type: 'table', label: 'Result', path: 'outputs/result.csv' }],
    readme: '# Document Tools\n\nExercise the bundled document helpers.\n',
    runJs: `export default async function ({ workspace, run, pdf, csv, zip }) {
      const source = await workspace.readBytes('apps/document-tools/inputs/invoice.pdf');
      const text = await pdf.extractText(source);
      const archive = zip.create({ 'invoice.txt': text });
      await workspace.writeBytes('apps/document-tools/outputs/invoice.zip', archive);
      const restored = zip.extract(archive);
      const restoredText = new TextDecoder().decode(restored['invoice.txt']);
      const rows = csv.parse('name,quantity\\nWalnuts,4\\n', { columns: true });
      rows.push({ name: restoredText, quantity: 1 });
      await workspace.write('apps/document-tools/outputs/result.csv', csv.stringify(rows, { header: true, columns: ['name', 'quantity'] }));
      run.log('Processed invoice.pdf');
    }`,
  });
  await runlet.writeAppInput(current.id, 'document-tools', 'invoice.pdf', simplePdf('Invoice BAK-0020'));

  const result = await runlet.runApp(current.id, 'document-tools');
  assert.deepEqual(result.logs, ['Processed invoice.pdf']);
  assert.match(await runlet.readFile(current.id, 'apps/document-tools/outputs/result.csv'), /Invoice BAK-0020,1/);
  assert.ok((await fs.stat(path.join(current.path, 'apps/document-tools/outputs/invoice.zip'))).size > 0);
});

test('Apps can create and read XLSX files and extract DOCX text', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.createApp({
    workspaceId: current.id,
    slug: 'office-tools',
    name: 'Office Tools',
    description: 'Exercise the bundled Excel and Word helpers.',
    readme: '# Office Tools\n\nExercise the bundled Excel and Word helpers.\n',
    runJs: `export default async function ({ workspace, run, xlsx, docx }) {
      const workbook = await xlsx.create({ Prices: [['ingredient', 'price'], ['Walnuts', 46.17]] });
      await workspace.writeBytes('apps/office-tools/outputs/prices.xlsx', workbook);
      const restored = await xlsx.read(workbook);
      const word = await workspace.readBytes('apps/office-tools/inputs/note.docx');
      const text = await docx.extractText(word);
      await workspace.write('apps/office-tools/outputs/result.json', { sheets: restored.sheets, text: text.trim() });
      run.log('Processed Excel and Word files.');
    }`,
  });
  await runlet.writeAppInput(current.id, 'office-tools', 'note.docx', simpleDocx('Runlet Word helper'));

  const result = await runlet.runApp(current.id, 'office-tools');
  assert.deepEqual(result.logs, ['Processed Excel and Word files.']);
  const output = JSON.parse(await runlet.readFile(current.id, 'apps/office-tools/outputs/result.json'));
  assert.equal(output.sheets[0].name, 'Prices');
  assert.deepEqual(output.sheets[0].rows, [['ingredient', 'price'], ['Walnuts', 46.17]]);
  assert.equal(output.text, 'Runlet Word helper');
  assert.ok((await fs.stat(path.join(current.path, 'apps/office-tools/outputs/prices.xlsx'))).size > 0);
});

test('creates, lists, and edits a reusable Prompt', async () => {
  const current = await runlet.getCurrentWorkspace();
  const created = await runlet.createPrompt({
    workspaceId: current.id,
    slug: 'extract-invoice',
    name: 'Extract Invoice',
    description: 'Turn invoice files into a CSV.',
    content: '# Extract Invoice\n\nRead the attached invoice PDF and return a CSV.\n',
  });
  assert.equal(created.name, 'Extract Invoice');
  assert.equal((await runlet.listPrompts(current.id)).length, 1);

  const updated = await runlet.updatePrompt(current.id, 'extract-invoice', '# Extract Invoice\n\nRead every attached invoice PDF and return one CSV.\n');
  assert.match(updated.content, /every attached invoice/);
  const renamed = await runlet.updatePromptMetadata(current.id, 'extract-invoice', { name: 'Invoice Extractor', description: 'Extract invoice rows.' });
  assert.equal(renamed.name, 'Invoice Extractor');

  const deleted = await runlet.deletePrompt(current.id, 'extract-invoice');
  assert.equal(deleted.deleted.name, 'Invoice Extractor');
  await assert.rejects(runlet.getPrompt(current.id, 'extract-invoice'), /Prompt not found/);
  await assert.rejects(fs.access(path.join(current.path, 'prompts/extract-invoice')));
});

test('saves custom App and Prompt ordering', async () => {
  const current = await runlet.getCurrentWorkspace();
  for (const [slug, name] of [['alpha-app', 'Alpha App'], ['zulu-app', 'Zulu App']]) {
    await runlet.createApp({
      workspaceId: current.id,
      slug,
      name,
      description: `${name} description.`,
      readme: `# ${name}\n\n${name} description.\n`,
      runJs: 'export default async function () {}',
    });
  }
  const appOrder = ['zulu-app', 'office-tools', 'document-tools', 'alpha-app'];
  const apps = await runlet.reorderItems(current.id, 'apps', appOrder);
  assert.deepEqual(apps.map((item) => item.slug), appOrder);
  assert.deepEqual((await runlet.listApps(current.id)).map((item) => item.slug), appOrder);
  await assert.rejects(runlet.reorderItems(current.id, 'apps', ['zulu-app', 'zulu-app']), /changed/i);

  for (const [slug, name] of [['first-prompt', 'First Prompt'], ['second-prompt', 'Second Prompt']]) {
    await runlet.createPrompt({
      workspaceId: current.id,
      slug,
      name,
      description: `${name} description.`,
      content: `# ${name}\n\n${name} description.\n`,
    });
  }
  const prompts = await runlet.reorderItems(current.id, 'prompts', ['second-prompt', 'first-prompt']);
  assert.deepEqual(prompts.map((item) => item.slug), ['second-prompt', 'first-prompt']);
  assert.deepEqual((await runlet.listPrompts(current.id)).map((item) => item.slug), ['second-prompt', 'first-prompt']);
});

test('builds a Claude Desktop extension for the installed Runlet server', async () => {
  const bundlePath = await connections.createClaudeDesktopExtension();
  const files = unzipSync(await fs.readFile(bundlePath));
  assert.ok(files['manifest.json']);
  assert.ok(files['server/index.mjs']);

  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.manifest_version, '0.4');
  assert.equal(manifest.name, 'runlet-local');
  assert.equal(manifest.version, '0.19.0');
  assert.equal(manifest.server.type, 'node');
  assert.equal(manifest.server.entry_point, 'server/index.mjs');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server/index.mjs']);
  assert.equal(manifest.tools_generated, true);

  const wrapper = strFromU8(files['server/index.mjs']);
  assert.match(wrapper, /RUNLET_STATE_DIR/);
  assert.match(wrapper, /mcp-server\.mjs/);
});

test('detects an installed Claude extension as connected', async () => {
  const claudeData = path.join(temporaryRoot, 'claude-data');
  await fs.mkdir(claudeData, { recursive: true });
  await fs.writeFile(path.join(claudeData, 'extensions-installations.json'), JSON.stringify({
    extensions: {
      'local.mcpb.runlet.runlet-local': {
        id: 'local.mcpb.runlet.runlet-local',
        version: '0.18.0',
        manifest: { name: 'runlet-local', version: '0.18.0' },
      },
    },
  }));
  process.env.RUNLET_CLAUDE_DATA_DIR = claudeData;
  try {
    const status = await connections.claudeDesktopStatus();
    assert.equal(status.name, 'Claude');
    assert.equal(status.connected, true);
    assert.equal(status.status, 'Connected');
    assert.equal(status.action, 'manage');
    assert.equal(status.actionLabel, 'Manage in Claude');
  } finally {
    delete process.env.RUNLET_CLAUDE_DATA_DIR;
  }
});

test('shows version and update commands in the CLI', async () => {
  const versionResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'version']);
  assert.equal(versionResult.stdout.trim(), '0.19.0');
  const helpResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'help']);
  assert.match(helpResult.stdout, /runlet update\s+Check for and install the latest release/);
  assert.match(helpResult.stdout, /runlet tools\s+Show the tools provided to connected AI apps/);
  assert.match(helpResult.stdout, /runlet libraries\s+Show the JavaScript APIs available to Apps/);
  const toolsResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'tools']);
  const toolNames = mcpToolGroups.flatMap((group) => group.tools.map(([name]) => name));
  assert.equal(toolNames.length, 30);
  assert.equal(new Set(toolNames).size, 30);
  assert.match(toolsResult.stdout, /Runlet tools provided to connected AI apps/);
  assert.match(toolsResult.stdout, /list_inboxes\s+List enabled Runlet Inboxes/);
  assert.match(toolsResult.stdout, /get_inbox\s+Inspect one configured Inbox/);
  assert.match(toolsResult.stdout, /write_file\s+Create or replace a text or binary file/);
  assert.match(toolsResult.stdout, /run_app\s+Run an App/);
  assert.match(toolsResult.stdout, /get_prompt_template\s+Get the authoritative Prompt structure/);
  assert.doesNotMatch(toolsResult.stdout, /create_app|create_prompt|update_inbox_instructions|get_app_results/);
  assert.match(toolsResult.stdout, /only explicitly registered Runlet workspaces/);
  const librariesResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'libraries']);
  assert.match(librariesResult.stdout, /pdf\.extractText/);
  assert.match(librariesResult.stdout, /csv\.parse \/ stringify/);
  assert.match(librariesResult.stdout, /xlsx\.read \/ create/);
  assert.match(librariesResult.stdout, /docx\.extractText/);
  assert.match(librariesResult.stdout, /Apps cannot import packages/);
  assert.match(librariesResult.stdout, /APPS\.md/);
});
