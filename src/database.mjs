import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse as parseCsv } from 'csv-parse/sync';

const rowIdColumn = '__runlet_id';

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
const plain = (value) => value && typeof value === 'object' ? { ...value } : value;

function databasePath(workspacePath) {
  return path.join(workspacePath, '.runlet', 'workspace.sqlite');
}

async function openDatabase(workspacePath) {
  await fs.mkdir(path.join(workspacePath, '.runlet'), { recursive: true });
  const db = new DatabaseSync(databasePath(workspacePath));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS _runlet_tables (
    id INTEGER PRIMARY KEY,
    inbox_path TEXT UNIQUE NOT NULL,
    table_name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT 'inbox',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS _runlet_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (table_name, column_name),
    FOREIGN KEY (table_name) REFERENCES _runlet_tables(table_name) ON DELETE CASCADE
  )`);
  const metadataColumns = new Set(db.prepare('PRAGMA table_info(_runlet_tables)').all().map((column) => column.name));
  if (!metadataColumns.has('source_kind')) db.exec("ALTER TABLE _runlet_tables ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'inbox'");
  if (!metadataColumns.has('description')) db.exec("ALTER TABLE _runlet_tables ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  return db;
}

function tableSlug(value) {
  const slug = String(value || 'table').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
  return slug.startsWith('runlet_') ? `data_${slug}` : slug;
}

function columnsFor(db, tableName) {
  const columns = db.prepare(`PRAGMA table_info(${quote(tableName)})`).all()
    .filter((column) => column.name !== rowIdColumn)
    .map((column) => ({ name: String(column.name), type: String(column.type || 'TEXT').toUpperCase(), cid: Number(column.cid) }));
  const saved = new Map(db.prepare('SELECT column_name, position FROM _runlet_columns WHERE table_name = ?').all(tableName)
    .map((column) => [column.column_name, Number(column.position)]));
  let nextPosition = saved.size ? Math.max(...saved.values()) + 1 : 0;
  const remember = db.prepare('INSERT OR IGNORE INTO _runlet_columns (table_name, column_name, position) VALUES (?, ?, ?)');
  for (const column of columns) {
    if (saved.has(column.name)) continue;
    saved.set(column.name, nextPosition);
    remember.run(tableName, column.name, nextPosition++);
  }
  return columns
    .sort((left, right) => saved.get(left.name) - saved.get(right.name) || left.cid - right.cid)
    .map(({ name, type }) => ({ name, type }));
}

function inferType(values) {
  const present = values.filter((value) => value !== '' && value !== null && value !== undefined).map(String);
  if (!present.length) return 'TEXT';
  if (present.every((value) => /^-?\d+$/.test(value))) return 'INTEGER';
  if (present.every((value) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))) return 'REAL';
  return 'TEXT';
}

function coerce(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'INTEGER') {
    const number = Number(value);
    if (!Number.isInteger(number)) throw new Error('Enter a whole number.');
    return number;
  }
  if (type === 'REAL') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error('Enter a number.');
    return number;
  }
  return String(value);
}

function registeredTable(db, tableName) {
  const table = db.prepare('SELECT inbox_path, table_name, display_name, description, source_kind FROM _runlet_tables WHERE table_name = ?').get(String(tableName));
  if (!table) throw new Error('Data table not found.');
  return plain(table);
}

function chooseTableName(db, inboxPath) {
  const base = tableSlug(path.basename(inboxPath));
  let name = base;
  let suffix = 2;
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  while (exists.get(name)) name = `${base}_${suffix++}`;
  return name;
}

function uniqueHeaders(header) {
  const seen = new Set();
  return header.map((value, index) => {
    const name = String(value || '').trim();
    if (!name) throw new Error(`CSV column ${index + 1} has no name.`);
    if (name === rowIdColumn || name.startsWith('_runlet_')) throw new Error(`CSV column “${name}” is reserved by Runlet.`);
    if (seen.has(name)) throw new Error(`CSV column “${name}” appears more than once.`);
    seen.add(name);
    return name;
  });
}

export async function ensureWorkspaceDatabase(workspacePath) {
  const db = await openDatabase(workspacePath);
  db.close();
  return databasePath(workspacePath);
}

export async function ensureInboxTable(workspacePath, inboxPath, { legacyCsvPath, displayName, tableName } = {}) {
  const db = await openDatabase(workspacePath);
  try {
    if (tableName) {
      const named = db.prepare('SELECT table_name FROM _runlet_tables WHERE table_name = ?').get(tableName);
      if (named) {
        db.prepare("UPDATE _runlet_tables SET inbox_path = ?, display_name = ?, source_kind = 'inbox' WHERE table_name = ?")
          .run(inboxPath, String(displayName || path.basename(inboxPath)), tableName);
        return tableDescriptor(db, tableName);
      }
    }
    const existing = db.prepare('SELECT inbox_path, table_name, display_name FROM _runlet_tables WHERE inbox_path = ?').get(inboxPath);
    if (existing) return tableDescriptor(db, existing.table_name);

    let header = ['source_file'];
    let rows = [];
    if (legacyCsvPath) {
      const source = await fs.readFile(legacyCsvPath, 'utf8').catch(() => '');
      if (source.trim()) {
        const parsed = parseCsv(source, { relax_column_count: false, skip_empty_lines: true });
        if (parsed.length) {
          header = uniqueHeaders(parsed[0]);
          rows = parsed.slice(1);
        }
      }
    }
    const chosenTableName = chooseTableName(db, inboxPath);
    const types = header.map((_, index) => inferType(rows.map((row) => row[index])));
    const definitions = header.map((name, index) => `${quote(name)} ${types[index]}`).join(', ');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE ${quote(chosenTableName)} (${quote(rowIdColumn)} INTEGER PRIMARY KEY AUTOINCREMENT${definitions ? `, ${definitions}` : ''})`);
      if (rows.length) {
        const placeholders = header.map(() => '?').join(', ');
        const insert = db.prepare(`INSERT INTO ${quote(chosenTableName)} (${header.map(quote).join(', ')}) VALUES (${placeholders})`);
        for (const row of rows) insert.run(...header.map((_, index) => coerce(row[index] ?? '', types[index])));
      }
      db.prepare("INSERT INTO _runlet_tables (inbox_path, table_name, display_name, source_kind, created_at) VALUES (?, ?, ?, 'inbox', ?)")
        .run(inboxPath, chosenTableName, String(displayName || path.basename(inboxPath)), new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return tableDescriptor(db, chosenTableName);
  } finally {
    db.close();
  }
}

export async function createDataTable(workspacePath, displayName) {
  const name = String(displayName || '').trim();
  if (!name) throw new Error('Table name is required.');
  const db = await openDatabase(workspacePath);
  try {
    const duplicate = db.prepare("SELECT 1 FROM _runlet_tables WHERE source_kind = 'table' AND display_name = ? COLLATE NOCASE").get(name);
    if (duplicate) throw new Error('A Table with that name already exists.');
    const chosenTableName = chooseTableName(db, name);
    const storagePath = `.runlet/tables/${chosenTableName}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE ${quote(chosenTableName)} (${quote(rowIdColumn)} INTEGER PRIMARY KEY AUTOINCREMENT, ${quote('Column 1')} TEXT)`);
      db.prepare("INSERT INTO _runlet_tables (inbox_path, table_name, display_name, description, source_kind, created_at) VALUES (?, ?, ?, ?, 'table', ?)")
        .run(storagePath, chosenTableName, name, 'A table for organizing information.', new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return tableDescriptor(db, chosenTableName);
  } finally {
    db.close();
  }
}

export async function updateDataTableMetadata(workspacePath, tableName, { name, description }) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    if (table.source_kind !== 'table') throw new Error('Inbox Data names are managed by their folders.');
    const nextName = String(name ?? table.display_name).trim();
    const nextDescription = String(description ?? table.description).trim();
    if (!nextName) throw new Error('Name cannot be empty.');
    if (!nextDescription) throw new Error('Description cannot be empty.');
    const duplicate = db.prepare("SELECT 1 FROM _runlet_tables WHERE source_kind = 'table' AND table_name <> ? AND display_name = ? COLLATE NOCASE")
      .get(table.table_name, nextName);
    if (duplicate) throw new Error('A Table with that name already exists.');
    db.prepare('UPDATE _runlet_tables SET display_name = ?, description = ? WHERE table_name = ?')
      .run(nextName, nextDescription, table.table_name);
    return tableDescriptor(db, table.table_name);
  } finally {
    db.close();
  }
}

export async function deleteDataTable(workspacePath, tableName) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    if (table.source_kind !== 'table') throw new Error('Inbox tables are removed with their Inbox folder.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`DROP TABLE ${quote(table.table_name)}`);
      db.prepare('DELETE FROM _runlet_tables WHERE table_name = ?').run(table.table_name);
      db.exec('COMMIT');
      return { deleted: table.table_name, name: table.display_name };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function tableDescriptor(db, tableName) {
  const table = registeredTable(db, tableName);
  const count = db.prepare(`SELECT COUNT(*) AS count FROM ${quote(table.table_name)}`).get().count;
  return { ...table, columns: columnsFor(db, table.table_name), rowCount: Number(count) };
}

export async function listDataTables(workspacePath) {
  const db = await openDatabase(workspacePath);
  try {
    return db.prepare('SELECT table_name FROM _runlet_tables ORDER BY display_name COLLATE NOCASE').all()
      .map((row) => tableDescriptor(db, row.table_name));
  } finally {
    db.close();
  }
}

export async function getDataTable(workspacePath, tableName, { limit = 1000, offset = 0 } = {}) {
  const db = await openDatabase(workspacePath);
  try {
    const table = tableDescriptor(db, tableName);
    const safeLimit = Math.min(5000, Math.max(1, Number(limit) || 1000));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const rows = db.prepare(`SELECT * FROM ${quote(table.table_name)} ORDER BY ${quote(rowIdColumn)} LIMIT ? OFFSET ?`).all(safeLimit, safeOffset)
      .map((row) => ({ id: Number(row[rowIdColumn]), values: Object.fromEntries(table.columns.map((column) => [column.name, row[column.name] ?? ''])) }));
    return { ...table, rows, limit: safeLimit, offset: safeOffset };
  } finally {
    db.close();
  }
}

export async function getDistinctValues(workspacePath, tableName, columnName) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const column = columnsFor(db, table.table_name).find((item) => item.name === columnName);
    if (!column) throw new Error(`Column “${columnName}” was not found in ${tableName}.`);
    return db.prepare(`SELECT DISTINCT ${quote(column.name)} AS value FROM ${quote(table.table_name)} WHERE ${quote(column.name)} IS NOT NULL AND ${quote(column.name)} != '' ORDER BY ${quote(column.name)}`)
      .all().map((row) => String(row.value));
  } finally {
    db.close();
  }
}

function ensureColumns(db, tableName, records) {
  const existing = new Map(columnsFor(db, tableName).map((column) => [column.name, column.type]));
  const names = [...new Set(records.flatMap((record) => Object.keys(record || {})))];
  for (const name of names) {
    if (!name || name === rowIdColumn || name.startsWith('_runlet_')) throw new Error(`Column “${name}” is reserved by Runlet.`);
    if (existing.has(name)) continue;
    const type = inferType(records.map((record) => record?.[name]));
    db.exec(`ALTER TABLE ${quote(tableName)} ADD COLUMN ${quote(name)} ${type}`);
    existing.set(name, type);
  }
  return existing;
}

export async function writeDataRows(workspacePath, tableName, records, { keyColumns = [] } = {}) {
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) throw new Error('Rows must be objects.');
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    db.exec('BEGIN IMMEDIATE');
    try {
      const columnTypes = ensureColumns(db, table.table_name, records);
      for (const key of keyColumns) if (!columnTypes.has(key)) throw new Error(`Key column “${key}” was not found.`);
      let inserted = 0;
      let updated = 0;
      for (const record of records) {
        const names = Object.keys(record);
        if (!names.length) continue;
        const values = names.map((name) => coerce(record[name], columnTypes.get(name)));
        let rowId = null;
        if (keyColumns.length) {
          const where = keyColumns.map((name) => `${quote(name)} IS ?`).join(' AND ');
          const match = db.prepare(`SELECT ${quote(rowIdColumn)} AS id FROM ${quote(table.table_name)} WHERE ${where} LIMIT 1`)
            .get(...keyColumns.map((name) => coerce(record[name], columnTypes.get(name))));
          rowId = match?.id ?? null;
        }
        if (rowId !== null) {
          db.prepare(`UPDATE ${quote(table.table_name)} SET ${names.map((name) => `${quote(name)} = ?`).join(', ')} WHERE ${quote(rowIdColumn)} = ?`).run(...values, rowId);
          updated += 1;
        } else {
          db.prepare(`INSERT INTO ${quote(table.table_name)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values);
          inserted += 1;
        }
      }
      db.exec('COMMIT');
      return { inserted, updated, total: tableDescriptor(db, table.table_name).rowCount };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function updateDataCell(workspacePath, tableName, rowId, columnName, value) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const column = columnsFor(db, table.table_name).find((item) => item.name === columnName);
    if (!column) throw new Error('Column not found.');
    const result = db.prepare(`UPDATE ${quote(table.table_name)} SET ${quote(column.name)} = ? WHERE ${quote(rowIdColumn)} = ?`)
      .run(coerce(value, column.type), Number(rowId));
    if (!result.changes) throw new Error('Row not found.');
    return { rowId: Number(rowId), column: column.name, value: value ?? '' };
  } finally {
    db.close();
  }
}

export async function addDataRow(workspacePath, tableName, values = {}) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const columns = columnsFor(db, table.table_name);
    const names = Object.keys(values).filter((name) => columns.some((column) => column.name === name));
    const types = new Map(columns.map((column) => [column.name, column.type]));
    const result = names.length
      ? db.prepare(`INSERT INTO ${quote(table.table_name)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((name) => coerce(values[name], types.get(name))))
      : db.prepare(`INSERT INTO ${quote(table.table_name)} DEFAULT VALUES`).run();
    return { rowId: Number(result.lastInsertRowid) };
  } finally {
    db.close();
  }
}

export async function deleteDataRow(workspacePath, tableName, rowId) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const result = db.prepare(`DELETE FROM ${quote(table.table_name)} WHERE ${quote(rowIdColumn)} = ?`).run(Number(rowId));
    if (!result.changes) throw new Error('Row not found.');
    return { deleted: Number(rowId) };
  } finally {
    db.close();
  }
}

export async function addDataColumn(workspacePath, tableName, columnName) {
  const name = String(columnName || '').trim();
  if (!name) throw new Error('Enter a column name.');
  if (name === rowIdColumn || name.startsWith('_runlet_')) throw new Error(`Column “${name}” is reserved by Runlet.`);
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const columns = columnsFor(db, table.table_name);
    if (columns.some((column) => column.name.toLowerCase() === name.toLowerCase())) throw new Error('A column with that name already exists.');
    db.exec(`ALTER TABLE ${quote(table.table_name)} ADD COLUMN ${quote(name)} TEXT`);
    db.prepare('INSERT INTO _runlet_columns (table_name, column_name, position) VALUES (?, ?, ?)').run(table.table_name, name, columns.length);
    return tableDescriptor(db, table.table_name);
  } finally {
    db.close();
  }
}

export async function renameDataColumn(workspacePath, tableName, columnName, newColumnName) {
  const name = String(newColumnName || '').trim();
  if (!name) throw new Error('Enter a column name.');
  if (name === rowIdColumn || name.startsWith('_runlet_')) throw new Error(`Column “${name}” is reserved by Runlet.`);
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const columns = columnsFor(db, table.table_name);
    const column = columns.find((item) => item.name === columnName);
    if (!column) throw new Error('Column not found.');
    if (column.name === name) return tableDescriptor(db, table.table_name);
    if (columns.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new Error('A column with that name already exists.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE ${quote(table.table_name)} RENAME COLUMN ${quote(column.name)} TO ${quote(name)}`);
      db.prepare('UPDATE _runlet_columns SET column_name = ? WHERE table_name = ? AND column_name = ?').run(name, table.table_name, column.name);
      db.exec('COMMIT');
      return tableDescriptor(db, table.table_name);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function deleteDataColumn(workspacePath, tableName, columnName) {
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const columns = columnsFor(db, table.table_name);
    const column = columns.find((item) => item.name === columnName);
    if (!column) throw new Error('Column not found.');
    if (columns.length === 1) throw new Error('A table needs at least one column.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE ${quote(table.table_name)} DROP COLUMN ${quote(column.name)}`);
      db.prepare('DELETE FROM _runlet_columns WHERE table_name = ? AND column_name = ?').run(table.table_name, column.name);
      columns.filter((item) => item.name !== column.name).forEach((item, index) => {
        db.prepare('UPDATE _runlet_columns SET position = ? WHERE table_name = ? AND column_name = ?').run(index, table.table_name, item.name);
      });
      db.exec('COMMIT');
      return tableDescriptor(db, table.table_name);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function moveDataColumn(workspacePath, tableName, columnName, direction) {
  if (!['left', 'right'].includes(direction)) throw new Error('Column direction must be left or right.');
  const db = await openDatabase(workspacePath);
  try {
    const table = registeredTable(db, tableName);
    const columns = columnsFor(db, table.table_name);
    const index = columns.findIndex((column) => column.name === columnName);
    if (index < 0) throw new Error('Column not found.');
    const target = direction === 'left' ? index - 1 : index + 1;
    if (target < 0 || target >= columns.length) return tableDescriptor(db, table.table_name);
    [columns[index], columns[target]] = [columns[target], columns[index]];
    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare('UPDATE _runlet_columns SET position = ? WHERE table_name = ? AND column_name = ?');
      columns.forEach((column, position) => update.run(position, table.table_name, column.name));
      db.exec('COMMIT');
      return tableDescriptor(db, table.table_name);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function deleteInboxTables(workspacePath, inboxPath) {
  const db = await openDatabase(workspacePath);
  try {
    const normalized = String(inboxPath).replaceAll('\\', '/').replace(/\/$/, '');
    const tables = db.prepare("SELECT inbox_path, table_name FROM _runlet_tables WHERE source_kind = 'inbox'").all()
      .filter((table) => table.inbox_path === normalized || table.inbox_path.startsWith(`${normalized}/`));
    if (!tables.length) return { deleted: [] };
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of tables) db.exec(`DROP TABLE ${quote(table.table_name)}`);
      const remove = db.prepare('DELETE FROM _runlet_tables WHERE table_name = ?');
      for (const table of tables) remove.run(table.table_name);
      db.exec('COMMIT');
      return { deleted: tables.map((table) => table.table_name) };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

export function createAppDataApi(workspacePath) {
  return Object.freeze({
    listTables: () => listDataTables(workspacePath),
    read: async (tableName, options = {}) => {
      const table = await getDataTable(workspacePath, tableName, options);
      return table.rows.map((row) => ({ ...row.values }));
    },
    insert: (tableName, rows) => writeDataRows(workspacePath, tableName, Array.isArray(rows) ? rows : [rows]),
    upsert: (tableName, rows, keyColumns = []) => writeDataRows(workspacePath, tableName, Array.isArray(rows) ? rows : [rows], { keyColumns }),
  });
}
