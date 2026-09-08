import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';

const execFileAsync = promisify(execFile);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runlet-test-'));
process.env.RUNLET_STATE_DIR = path.join(temporaryRoot, 'state');
const runlet = await import('../src/workspaces.mjs');
const connections = await import('../src/connections.mjs');

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

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('creates a workspace with separate Scripts and Prompts folders', async () => {
  const workspace = await runlet.createWorkspace({ name: 'Test', folderPath: path.join(temporaryRoot, 'workspace'), create: true });
  assert.equal((await runlet.getCurrentWorkspace()).id, workspace.id);
  assert.equal((await fs.stat(path.join(workspace.path, 'scripts'))).isDirectory(), true);
  assert.equal((await fs.stat(path.join(workspace.path, 'prompts'))).isDirectory(), true);
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

test('creates and runs a Script', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.writeFile(current.id, 'recipes.csv', 'recipe\nSourdough\nBaguette\nSourdough\n');
  await runlet.createScript({
    workspaceId: current.id,
    slug: 'copy-text',
    name: 'Recipe Message',
    description: 'Write a message for one recipe.',
    controls: [
      { name: 'recipe', label: 'Recipe', type: 'select', required: true, source: { type: 'csv-column', path: 'recipes.csv', column: 'recipe' } },
      { name: 'message', label: 'Message', type: 'text', required: true },
    ],
    results: [{ type: 'summary', label: 'Result', path: 'outputs/result.txt' }],
    readme: '# Copy Text\n\nCopy one input into an output.\n',
    runJs: `export default async function ({ workspace, run, input }) {
      await workspace.write('scripts/copy-text/outputs/result.txt', input.recipe + ': ' + input.message.toUpperCase());
      run.log('Created message.');
    }`,
  });
  const listed = await runlet.getScript(current.id, 'copy-text');
  assert.deepEqual(listed.controls[0].options, ['Sourdough', 'Baguette']);
  const result = await runlet.runScript(current.id, 'copy-text', { recipe: 'Sourdough', message: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.logs, ['Created message.']);
  assert.equal(await runlet.readFile(current.id, 'scripts/copy-text/outputs/result.txt'), 'Sourdough: HELLO');
  assert.equal((await runlet.getScriptResults(current.id, 'copy-text'))[0].content, 'Sourdough: HELLO');

  const renamed = await runlet.updateScriptMetadata(current.id, 'copy-text', { name: 'Recipe Note', description: 'Make a short recipe note.' });
  assert.equal(renamed.name, 'Recipe Note');

  const binary = Buffer.from([0, 1, 2, 255]);
  await runlet.writeScriptOutput(current.id, 'copy-text', 'nested/result.bin', binary);
  assert.deepEqual(await fs.readFile(path.join(current.path, 'scripts/copy-text/outputs/nested/result.bin')), binary);

  const deleted = await runlet.deleteScript(current.id, 'copy-text');
  assert.equal(deleted.deleted.name, 'Recipe Note');
  await assert.rejects(runlet.getScript(current.id, 'copy-text'), /Script not found/);
  await assert.rejects(fs.access(path.join(current.path, 'scripts/copy-text')));
});

test('Scripts can extract PDF text and use bundled CSV and ZIP helpers', async () => {
  const current = await runlet.getCurrentWorkspace();
  await runlet.createScript({
    workspaceId: current.id,
    slug: 'document-tools',
    name: 'Document Tools',
    description: 'Exercise the bundled document helpers.',
    results: [{ type: 'table', label: 'Result', path: 'outputs/result.csv' }],
    readme: '# Document Tools\n\nExercise the bundled document helpers.\n',
    runJs: `export default async function ({ workspace, run, pdf, csv, zip }) {
      const source = await workspace.readBytes('scripts/document-tools/inputs/invoice.pdf');
      const text = await pdf.extractText(source);
      const archive = zip.create({ 'invoice.txt': text });
      await workspace.writeBytes('scripts/document-tools/outputs/invoice.zip', archive);
      const restored = zip.extract(archive);
      const restoredText = new TextDecoder().decode(restored['invoice.txt']);
      const rows = csv.parse('name,quantity\\nWalnuts,4\\n', { columns: true });
      rows.push({ name: restoredText, quantity: 1 });
      await workspace.write('scripts/document-tools/outputs/result.csv', csv.stringify(rows, { header: true, columns: ['name', 'quantity'] }));
      run.log('Processed invoice.pdf');
    }`,
  });
  await runlet.writeScriptInput(current.id, 'document-tools', 'invoice.pdf', simplePdf('Invoice BAK-0020'));

  const result = await runlet.runScript(current.id, 'document-tools');
  assert.deepEqual(result.logs, ['Processed invoice.pdf']);
  assert.match(await runlet.readFile(current.id, 'scripts/document-tools/outputs/result.csv'), /Invoice BAK-0020,1/);
  assert.ok((await fs.stat(path.join(current.path, 'scripts/document-tools/outputs/invoice.zip'))).size > 0);
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

test('builds a Claude Desktop extension for the installed Runlet server', async () => {
  const bundlePath = await connections.createClaudeDesktopExtension();
  const files = unzipSync(await fs.readFile(bundlePath));
  assert.ok(files['manifest.json']);
  assert.ok(files['server/index.mjs']);

  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.manifest_version, '0.4');
  assert.equal(manifest.name, 'runlet-local');
  assert.equal(manifest.version, '0.8.0');
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
        version: '0.8.0',
        manifest: { name: 'runlet-local', version: '0.8.0' },
      },
    },
  }));
  process.env.RUNLET_CLAUDE_DATA_DIR = claudeData;
  try {
    const status = await connections.claudeDesktopStatus();
    assert.equal(status.name, 'Claude');
    assert.equal(status.connected, true);
    assert.equal(status.status, 'Connected');
    assert.equal(status.actionLabel, 'Reinstall');
    assert.equal(status.invocation, 'Ask Runlet to…');
  } finally {
    delete process.env.RUNLET_CLAUDE_DATA_DIR;
  }
});

test('shows version and update commands in the CLI', async () => {
  const versionResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'version']);
  assert.equal(versionResult.stdout.trim(), '0.8.0');
  const helpResult = await execFileAsync(process.execPath, ['bin/runlet.mjs', 'help']);
  assert.match(helpResult.stdout, /runlet update\s+Check for and install the latest release/);
});
