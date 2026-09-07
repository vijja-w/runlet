import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'runlet-test-'));
process.env.RUNLET_STATE_DIR = path.join(temporaryRoot, 'state');
const runlet = await import('../src/workspaces.mjs');

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
});
