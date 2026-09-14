const app = document.querySelector('#app');
const initialLocation = new URLSearchParams(window.location.search);
let state = { workspaces: [], apps: [], prompts: [], files: [], dataTables: [], selected: null, connections: [] };
let view = ['apps', 'prompts', 'data', 'tables', 'files', 'connections'].includes(initialLocation.get('view')) ? initialLocation.get('view') : 'apps';
let selectedApp = null;
let selectedPrompt = null;
let appResults = [];
let appInputValues = {};
let appRunHistory = [];
let appHistoryOpen = false;
let selectedDataTable = null;
let dataTable = null;
let dataSearch = '';
let dataSortColumn = null;
let dataSortDirection = 'ascending';
let filePath = initialLocation.get('path') || '.';
let selectedWorkspaceId = null;
let connectionsLoading = false;
let appSearch = '';
let promptSearch = '';
let inboxDataSearch = '';
let tablesSearch = '';
let connectionSearch = '';
let fileSearch = '';
let fileSort = 'none';
let fileSortDirection = 'ascending';
let selectedFilePath = null;
let fileHistory = [filePath];
let fileHistoryIndex = 0;
let modalEscapeHandler = null;
let tooltipTimer = null;
let tooltipTarget = null;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const icons = {
  add: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  refresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7A6 6 0 1 0 16 11"/><path d="M15.5 3v4h-4"/></svg>',
  remove: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.5h11M8 3.5h4l1 3H7l1-3ZM6.5 6.5l.6 10h5.8l.6-10M8.5 9v5M11.5 9v5"/></svg>',
  grip: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="5" r="1"/><circle cx="13" cy="5" r="1"/><circle cx="7" cy="10" r="1"/><circle cx="13" cy="10" r="1"/><circle cx="7" cy="15" r="1"/><circle cx="13" cy="15" r="1"/></svg>',
  search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4 4"/></svg>',
  back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5.5 5.5 5.5 5.5"/></svg>',
  forward: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>',
  newFolder: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6.5h6l1.7-2h2.3l1.5 2h3.5v9H2.5z"/><path d="M10 9v4M8 11h4"/></svg>',
  sort: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5h10M5 10h7M5 15h4"/><path d="m14 13 2 2 2-2"/></svg>',
  instructions: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.5h8l4 4v11H4z"/><path d="M12 2.5v4h4M7 10h6M7 13h6"/></svg>',
  data: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="1"/><path d="M2.5 8h15M8 3.5v13M13 3.5v13"/></svg>',
  warning: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 8 14H2z"/><path d="M10 7v4M10 14h.01"/></svg>',
  info: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6h.01"/></svg>',
};
const iconButton = (icon, label, attributes = '') => `<button class="icon-button" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}" ${attributes}>${icons[icon]}</button>`;
const inlineInfo = (label, text, attributes = '') => `<button class="inline-info" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}" data-info-text="${escapeHtml(text)}" ${attributes}>i</button>`;
const dragHandle = (kind, slug) => `<button type="button" class="drag-handle" data-drag-kind="${kind}" data-drag-slug="${escapeHtml(slug)}" aria-label="Reorder ${kind}" data-tooltip="Drag to reorder">${icons.grip}</button>`;
const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

async function refresh() {
  const connections = state.connections || [];
  state = { ...await api('/api/state'), connections };
  if (selectedWorkspaceId && selectedWorkspaceId !== state.selected?.id) {
    selectedWorkspaceId = state.selected?.id || null;
    filePath = '.';
    fileHistory = ['.'];
    fileHistoryIndex = 0;
    selectedFilePath = null;
    selectedDataTable = null;
    dataTable = null;
  } else {
    selectedWorkspaceId = state.selected?.id || null;
  }
  if (state.selected && filePath !== '.') {
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
  }
  if (selectedApp) selectedApp = state.apps.find((app) => app.slug === selectedApp.slug) || null;
  if (selectedPrompt) selectedPrompt = state.prompts.find((prompt) => prompt.slug === selectedPrompt.slug) || null;
  render();
}

function render() {
  if (!state.selected) return renderWelcome();
  const collectionView = !selectedApp && !selectedPrompt && (view === 'apps' || view === 'prompts' || view === 'connections' || ((view === 'data' || view === 'tables') && !selectedDataTable));
  const content = selectedApp ? appDetail(selectedApp)
    : selectedPrompt ? promptDetail(selectedPrompt)
      : view === 'data' ? dataView() : view === 'tables' ? tablesView() : view === 'files' ? filesView() : view === 'prompts' ? promptsView() : view === 'connections' ? connectionsView() : appsView();
  app.innerHTML = `<main class="shell">
    <aside class="sidebar">
      <div class="brand"><span>R</span><b>Runlet</b></div>
      <button class="workspace-switch" id="workspace-switch">
        <span><b>${escapeHtml(state.selected.name)}</b><small class="workspace-breadcrumb">${workspaceBreadcrumb(state.selected.path)}</small></span>
      </button>
      <nav>
        <div class="nav-group">${sidebarNavItem('files', 'Files', state.files.length, 'Drop files onto a folder to copy them there. The original files stay where they are.')}</div>
        <div class="nav-group">${sidebarNavItem('data', 'Inbox Data', state.dataTables.filter((table) => table.source_kind !== 'table').length, selectedDataTable && view === 'data' && dataTable ? dataHelpText(dataTable) : 'Tables of information collected by your Inboxes.')}${sidebarNavItem('tables', 'Tables', state.dataTables.filter((table) => table.source_kind === 'table').length, selectedDataTable && view === 'tables' && dataTable ? dataHelpText(dataTable) : 'Spreadsheet-like data you create yourself. Your AI can also use Runlet to read and edit it.')}</div>
        <div class="nav-group">${sidebarNavItem('apps', 'Apps', state.apps.length, 'Small programs that run locally.')}${sidebarNavItem('prompts', 'Prompts', state.prompts.length, 'Saved instructions for your AI.')}</div>
        <div class="nav-group">${sidebarNavItem('connections', 'Connections', null, 'Connect Runlet to supported AI apps installed on this computer.')}</div>
      </nav>
    </aside>
    <section class="main ${collectionView ? 'collection-main' : ''} ${view === 'files' && !selectedApp && !selectedPrompt ? 'files-main' : ''} ${(view === 'data' || view === 'tables') && !selectedApp && !selectedPrompt ? 'data-main' : ''}">${content}</section>
  </main><div id="modal-root"></div><div id="toast-root"></div>`;
  bindEvents();
}

function sidebarNavItem(key, label, count, info) {
  return `<div class="nav-item ${view === key ? 'active' : ''}"><button data-view="${key}">${escapeHtml(label)}</button><span class="nav-item-meta">${inlineInfo(`About ${label}`, info)}</span></div>`;
}

function workspaceBreadcrumb(value) {
  const source = String(value || '').replaceAll('\\', '/');
  const parts = source.split('/').filter(Boolean);
  return `${source.startsWith('/') ? '<span>/</span>' : ''}${parts.map((part, index) => `${index ? '<i>›</i>' : ''}<span>${escapeHtml(part)}</span>`).join('')}`;
}

function renderWelcome() {
  app.innerHTML = `<main class="welcome"><section>
    <h1>Runlet</h1>
    <p>Choose a folder. Keep its files, Apps, and Prompts together.</p>
    <div class="welcome-actions">
      <button class="primary" id="add-workspace">Add workspace</button>
    </div>
    <small>Runlet only uses folders you add.</small>
  </section></main><div id="modal-root"></div><div id="toast-root"></div>`;
  document.querySelector('#add-workspace').onclick = () => workspaceModal();
}

function topbar(title, subtitle = '', controls = '', editableKind = '') {
  const backLabel = selectedApp ? 'Apps' : selectedPrompt ? 'Prompts' : '';
  const editable = editableKind
    ? `class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="${editableKind}"`
    : '';
  return `<header class="topbar"><div>
    ${backLabel ? `<button class="back" id="back">← ${backLabel}</button>` : ''}
    <h1 ${editable} data-meta-field="name">${escapeHtml(title)}</h1>
    ${subtitle || editableKind ? `<p ${editable} data-meta-field="description">${escapeHtml(subtitle)}</p>` : ''}
  </div><div class="top-controls">${controls}</div></header>`;
}

function appsView() {
  const cards = state.apps.length
    ? state.apps.map((app) => `<article class="action-card" data-app="${escapeHtml(app.slug)}" data-order-item="${escapeHtml(app.slug)}" data-search-text="${escapeHtml(`${app.name} ${app.description}`.toLowerCase())}">
        <div class="action-copy">
          <h2>${escapeHtml(app.name)}</h2>
          <p>${escapeHtml(app.description)}</p>
        </div>
        <div class="card-actions">
          <button class="primary small open-app" data-open-app="${escapeHtml(app.slug)}">Open</button>
          ${dragHandle('app', app.slug)}
        </div>
      </article>`).join('')
    : `<div class="empty"><h2>No Apps yet</h2><p>Try asking: “Ask Runlet to create an App in ${escapeHtml(state.selected.name)}.”</p></div>`;
  const search = state.apps.length ? listSearch('app', appSearch) : '';
  return `<div class="page collection-page">${collectionToolbar(search)}<div class="action-list" data-filter-list="app" data-order-list="apps">${cards}${noSearchResults('app', 'Apps')}</div></div>`;
}

function promptsView() {
  const cards = state.prompts.length
    ? state.prompts.map((prompt) => `<article class="action-card" data-prompt="${escapeHtml(prompt.slug)}" data-order-item="${escapeHtml(prompt.slug)}" data-search-text="${escapeHtml(`${prompt.name} ${prompt.description}`.toLowerCase())}">
        <div class="action-copy"><h2>${escapeHtml(prompt.name)}</h2><p>${escapeHtml(prompt.description)}</p></div>
        <div class="card-actions">
          <button class="secondary small copy-prompt" data-copy-prompt="${escapeHtml(prompt.slug)}">Copy</button>
          ${dragHandle('prompt', prompt.slug)}
        </div>
      </article>`).join('')
    : `<div class="empty"><h2>No Prompts yet</h2><p>Try asking: “Ask Runlet to create a Prompt in ${escapeHtml(state.selected.name)}.”</p></div>`;
  const search = state.prompts.length ? listSearch('prompt', promptSearch) : '';
  return `<div class="page collection-page">${collectionToolbar(search)}<div class="action-list" data-filter-list="prompt" data-order-list="prompts">${cards}${noSearchResults('prompt', 'Prompts')}</div></div>`;
}

function dataView() {
  const tables = (state.dataTables || []).filter((table) => table.source_kind !== 'table');
  if (selectedDataTable) {
    const summary = tables.find((table) => table.table_name === selectedDataTable);
    const active = dataTable?.table_name === selectedDataTable ? dataTable : null;
    const title = summary?.display_name || selectedDataTable;
    return `<div class="data-detail">${active ? renderDataSheet(active) : '<div class="empty"><p>Loading table…</p></div>'}</div>`;
  }
  const cards = tables.length
    ? tables.map((table) => `<article class="action-card" data-data-table="${escapeHtml(table.table_name)}" data-search-text="${escapeHtml(`${table.inbox_path} ${table.display_name}`.toLowerCase())}">
        <div class="action-copy data-table-copy">${dataListBreadcrumb(table)}<small>${table.rowCount} ${table.rowCount === 1 ? 'row' : 'rows'}</small></div>
        <div class="card-actions"><button class="primary small" data-open-data-table="${escapeHtml(table.table_name)}">Open</button></div>
      </article>`).join('')
    : `<div class="empty"><h2>No Inbox Data yet</h2><p>Turn a folder into an Inbox to give it a table.</p></div>`;
  const search = tables.length ? listSearch('inbox-data', inboxDataSearch, 'Inbox Data') : '';
  return `<div class="page collection-page">${collectionToolbar(search)}<div class="action-list" data-filter-list="inbox-data">${cards}${noSearchResults('inbox-data', 'Inbox Data')}</div></div>`;
}

function tablesView() {
  const tables = (state.dataTables || []).filter((table) => table.source_kind === 'table');
  if (selectedDataTable) {
    const active = dataTable?.table_name === selectedDataTable ? dataTable : null;
    return `<div class="data-detail">${active ? renderDataSheet(active) : '<div class="empty"><p>Loading table…</p></div>'}</div>`;
  }
  const cards = tables.length
    ? tables.map((table) => `<article class="action-card" data-data-table="${escapeHtml(table.table_name)}" data-order-item="${escapeHtml(table.table_name)}" data-search-text="${escapeHtml(table.display_name.toLowerCase())}"><div class="action-copy"><h2>${escapeHtml(table.display_name)}</h2><small>${table.rowCount} ${table.rowCount === 1 ? 'row' : 'rows'}</small></div><div class="card-actions"><button class="primary small" data-open-data-table="${escapeHtml(table.table_name)}">Open</button>${dragHandle('table', table.table_name)}</div></article>`).join('')
    : `<div class="empty"><h2>No Tables yet</h2><p>Create a table for information you want to organize yourself.</p></div>`;
  const search = tables.length ? listSearch('table-list', tablesSearch, 'Tables') : '';
  return `<div class="page collection-page">${collectionToolbar(search, iconButton('add', 'New Table', 'id="new-data-table"'))}<div class="action-list" data-filter-list="table-list" data-order-list="tables">${cards}${noSearchResults('table-list', 'Tables')}</div></div>`;
}

function dataListBreadcrumb(table) {
  const parts = String(table.inbox_path || table.display_name || '').split('/').filter(Boolean);
  const labels = [state.selected.name, ...parts];
  return `<div class="data-list-breadcrumb" title="${escapeHtml(labels.join(' › '))}">${labels.map((part, index) => `${index ? '<i>›</i>' : ''}<span>${escapeHtml(part)}</span>`).join('')}</div>`;
}

function dataRowsForDisplay(table) {
  const query = dataSearch.trim().toLowerCase();
  const rows = (table.rows || []).filter((row) => !query || table.columns.some((column) => String(row.values[column.name] ?? '').toLowerCase().includes(query)));
  if (!dataSortColumn) return rows;
  const direction = dataSortDirection === 'ascending' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left.values[dataSortColumn] ?? '';
    const b = right.values[dataSortColumn] ?? '';
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * direction;
  });
}

function renderDataSheet(table) {
  const rows = dataRowsForDisplay(table);
  const headers = table.columns.map((column, index) => {
    const active = dataSortColumn === column.name;
    const arrow = active ? (dataSortDirection === 'ascending' ? ' ↑' : ' ↓') : '';
    return `<th class="data-column-heading"><div><button class="data-column-sort" data-data-sort="${escapeHtml(column.name)}">${escapeHtml(column.name)}${arrow}</button>${dataMenu(`Column options for ${column.name}`, `
      <button data-rename-data-column="${escapeHtml(column.name)}">Rename</button>
      <button data-move-data-column="left" data-data-column-name="${escapeHtml(column.name)}" ${index === 0 ? 'disabled' : ''}>Move left</button>
      <button data-move-data-column="right" data-data-column-name="${escapeHtml(column.name)}" ${index === table.columns.length - 1 ? 'disabled' : ''}>Move right</button>
      <button class="menu-danger" data-delete-data-column="${escapeHtml(column.name)}">Delete</button>`)}</div></th>`;
  }).join('');
  const body = rows.map((row, index) => `<tr data-data-row-record="${row.id}"><th class="data-row-number"><span>${index + 1}</span>${dataMenu(`Row ${index + 1} options`, `<button class="menu-danger" data-delete-data-row="${row.id}">Delete</button>`)}</th>${table.columns.map((column) => {
    const value = formatDataValue(column, row.values[column.name]);
    const numeric = ['INTEGER', 'REAL'].includes(column.type) ? ' data-number' : '';
    return `<td class="${numeric}" contenteditable="plaintext-only" spellcheck="false" data-data-row="${row.id}" data-data-column="${escapeHtml(column.name)}" data-original="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
  }).join('')}</tr>`).join('');
  return `<section class="data-sheet">
    <div class="data-sheet-toolbar"><nav class="breadcrumbs data-path-breadcrumb" aria-label="Inbox folder">${dataFileBreadcrumbs(table)}</nav><label class="data-search compact-search">${icons.search}<span class="visually-hidden">Search table</span><input id="data-search" type="search" value="${escapeHtml(dataSearch)}" placeholder="Search"></label><span class="data-visible-count">${rows.length}${dataSearch ? ` of ${table.rowCount}` : ''} rows</span><button class="data-compact-action" id="add-data-row">+ Row</button><button class="data-compact-action" id="add-data-column">+ Col</button>${table.source_kind === 'table' ? iconButton('remove', 'Delete Table', 'data-delete-data-table') : ''}${iconButton('refresh', 'Refresh', 'id="refresh"')}</div>
    <div class="data-grid-wrap"><table class="data-grid"><thead><tr><th class="data-corner"></th>${headers}</tr></thead><tbody>${body || `<tr><td class="data-empty-row" colspan="${table.columns.length + 1}">No matching rows.</td></tr>`}</tbody></table></div>
  </section>`;
}

function dataHelpText(table) {
  const target = table.source_kind === 'table'
    ? `the ${table.table_name} table in the ‘${state.selected.name}’ workspace`
    : `the ${table.table_name} table for the Inbox at ‘${table.inbox_path}’ in the ‘${state.selected.name}’ workspace`;
  return `Edit cells directly, or use the three-dot menus to rename and move columns or delete rows and columns.\n\nFor more advanced edits, you can also ask your AI: “Use Runlet to modify ${target}.”`;
}

function dataFileBreadcrumbs(table) {
  if (table.source_kind === 'table') return `<button data-tables-home>Tables</button><span>›</span><button aria-current="page">${escapeHtml(table.display_name)}</button>`;
  const parts = String(table.inbox_path || table.display_name || '').split('/').filter(Boolean);
  const crumbs = [`<button data-data-file-path=".">${escapeHtml(state.selected.name)}</button>`];
  parts.forEach((part, index) => {
    const target = parts.slice(0, index + 1).join('/');
    crumbs.push(`<span>›</span><button data-data-file-path="${escapeHtml(target)}" ${index === parts.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(part)}</button>`);
  });
  return crumbs.join('');
}

function dataMenu(label, content) {
  return `<details class="data-menu"><summary aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">•••</summary><div>${content}</div></details>`;
}

function formatDataValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'REAL' && /(?:usd|price|cost|amount|total)/i.test(column.name) && Number.isFinite(Number(value))) return Number(value).toFixed(2);
  return String(value);
}

function listSearch(kind, value, customLabel = '') {
  const label = customLabel || (kind === 'app' ? 'Apps' : 'Prompts');
  return `<label class="list-search compact-search" for="${kind}-search">${icons.search}<span class="visually-hidden">Search ${label}</span><input id="${kind}-search" type="search" value="${escapeHtml(value)}" placeholder="Search ${label}" autocomplete="off"></label>`;
}

function collectionToolbar(search, controls = '') {
  return `<div class="collection-toolbar">${search || '<span></span>'}${controls ? `<div class="collection-toolbar-actions">${controls}</div>` : ''}</div>`;
}

function noSearchResults(kind, label) {
  return `<div class="empty compact search-empty" data-search-empty="${kind}" hidden><p>No matching ${label}.</p></div>`;
}

function appDetail(app) {
  const controlFields = app.controls.length
    ? app.controls.map((control) => renderAppControl(control)).join('')
    : '<p class="muted">This App is ready to run.</p>';
  const resultPanels = appResults.filter((result) => !result.missing).map(renderResult).join('');
  const topControls = `<button class="secondary" id="app-run-history" type="button">Run history</button>${app.hasPage ? `<a class="secondary" target="_blank" rel="noopener" href="/app-view/${state.selected.id}/${encodeURIComponent(app.slug)}">Open App</a>` : ''}${iconButton('remove', 'Delete App', `data-delete-kind="app" data-delete-slug="${escapeHtml(app.slug)}"`)}`;
  return `<div class="app-page"><div class="detail-toolbar"><div class="detail-identity"><h1 class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="app" data-meta-field="name">${escapeHtml(app.name)}</h1><p class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="app" data-meta-field="description">${escapeHtml(app.description)}</p></div><div class="top-controls">${topControls}</div></div>
    <form id="app-run-form" class="control-panel">
      <div class="control-grid">${controlFields}</div>
      <div class="run-footer"><span>Runs locally in this workspace.</span><button class="primary run-app" type="submit" data-run-app="${escapeHtml(app.slug)}">Run</button></div>
    </form>
    ${appHistoryOpen ? renderRunHistory() : ''}
    ${app.results.length ? `<section class="results-section"><h2>Results</h2><div class="results-grid">${resultPanels || '<div class="empty compact"><p>Run the App to see results.</p></div>'}</div></section>` : ''}
  </div>`;
}

function renderRunHistory() {
  const records = appRunHistory.length ? appRunHistory.map((run) => {
    const failed = run.status === 'failed';
    const timestamp = new Date(run.finishedAt || run.startedAt);
    const when = Number.isNaN(timestamp.valueOf()) ? '' : timestamp.toLocaleString();
    const duration = Number(run.durationMs) >= 1000 ? `${(Number(run.durationMs) / 1000).toFixed(1)}s` : `${Math.max(0, Number(run.durationMs) || 0)}ms`;
    const logs = (run.logs || []).length
      ? `<pre>${escapeHtml(run.logs.join('\n'))}</pre>`
      : '<p class="muted">No messages were recorded.</p>';
    const error = failed && run.error ? `<p class="run-error">${escapeHtml(run.error)}</p>` : '';
    const details = failed && run.details ? `<details><summary>Technical details</summary><pre>${escapeHtml(run.details)}</pre></details>` : '';
    return `<article class="run-record ${failed ? 'failed' : 'completed'}">
      <div class="run-record-heading"><strong>${failed ? 'Failed' : 'Completed'}</strong><span>${escapeHtml(when)} · ${escapeHtml(duration)}</span></div>
      ${error}${logs}${details}
    </article>`;
  }).join('') : '<div class="empty compact"><p>No runs recorded yet.</p></div>';
  return `<section class="run-history-section"><div class="run-history-heading"><h2>Run history</h2><button class="secondary small" id="close-run-history" type="button">Close</button></div><div class="run-history-list">${records}</div></section>`;
}

function renderAppControl(control) {
  const value = appInputValues[control.name] ?? control.default ?? control.options?.[0] ?? '';
  const required = control.required ? 'required' : '';
  if (control.type === 'select') {
    const options = (control.options || []).map((option) => `<option value="${escapeHtml(option)}" ${String(value) === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
    return `<label>${escapeHtml(control.label || control.name)}<select name="${escapeHtml(control.name)}" ${required}>${options}</select></label>`;
  }
  return `<label>${escapeHtml(control.label || control.name)}<input name="${escapeHtml(control.name)}" type="${control.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}" ${required}></label>`;
}

function renderResult(result) {
  if (result.type === 'table') {
    const head = (result.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const body = (result.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    return `<article class="result-card table-result"><h3>${escapeHtml(result.label || 'Results')}</h3><div class="table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></article>`;
  }
  return `<article class="result-card"><h3>${escapeHtml(result.label || 'Result')}</h3><div class="summary-output">${escapeHtml(result.content || '')}</div></article>`;
}

function promptDetail(prompt) {
  const controls = `<button class="secondary copy-prompt" data-copy-prompt="${escapeHtml(prompt.slug)}">Copy prompt</button>${iconButton('remove', 'Delete Prompt', `data-delete-kind="prompt" data-delete-slug="${escapeHtml(prompt.slug)}"`)}`;
  return `<div class="prompt-page"><div class="detail-toolbar"><div class="detail-identity"><h1 class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="prompt" data-meta-field="name">${escapeHtml(prompt.name)}</h1><p class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="prompt" data-meta-field="description">${escapeHtml(prompt.description)}</p></div><div class="top-controls">${controls}</div></div>
    <form id="prompt-form" class="prompt-editor">
      <label for="prompt-content">Prompt</label>
      <textarea id="prompt-content" name="content" spellcheck="true">${escapeHtml(prompt.content)}</textarea>
      <div class="editor-actions"><span>Try asking: “Ask Runlet to use the ${escapeHtml(prompt.name)} Prompt.”</span><button class="primary" type="submit">Save</button></div>
    </form>
  </div>`;
}

function filesView() {
  const rows = sortFiles(state.files).map((file) => {
    return `<div class="finder-row ${file.type === 'directory' ? 'directory-row' : ''} ${selectedFilePath === file.path ? 'selected' : ''}" role="row" tabindex="0" draggable="${file.type !== 'directory'}" data-file-entry="${escapeHtml(file.path)}" data-file-type="${file.type}" data-search-text="${escapeHtml(file.name.toLowerCase())}">
      <span class="file-name-cell" role="gridcell">${fileIcon(file)}<span class="file-name">${escapeHtml(file.name)}</span></span>
      <time role="gridcell" datetime="${escapeHtml(file.modifiedAt)}">${escapeHtml(formatFileDate(file.modifiedAt))}</time>
      <small role="gridcell">${file.type === 'directory' ? '--' : formatSize(file.size)}</small>
      ${inboxCell(file)}
    </div>`;
  }).join('');
  const currentName = filePath === '.' ? state.selected.name : filePath.split('/').filter(Boolean).at(-1);
  const sortLabels = { none: 'None', name: 'Name', inbox: 'Inbox', kind: 'Kind', modified: 'Date Modified', size: 'Size' };
  return `<header class="files-topbar">
    <div class="files-location"><nav class="breadcrumbs" aria-label="Current folder">${fileBreadcrumbs()}</nav></div>
    <div class="files-actions">
      <label class="file-search compact-search" for="file-search">${icons.search}<span class="visually-hidden">Search this folder</span><input id="file-search" type="search" value="${escapeHtml(fileSearch)}" placeholder="Search" autocomplete="off"></label>
      <details class="sort-menu"><summary class="icon-button" aria-label="Sort files" data-tooltip="Sort files">${icons.sort}</summary><div class="sort-popover" role="menu"><p>Sort by</p>${Object.entries(sortLabels).map(([value, label]) => `<button role="menuitemradio" aria-label="${label}" aria-checked="${fileSort === value}" data-file-sort="${value}"><span>${fileSort === value ? '✓' : ''}</span>${label}</button>`).join('')}</div></details>
      ${iconButton('newFolder', 'New Folder', 'id="new-folder"')}
      ${iconButton('refresh', 'Refresh', 'id="refresh"')}
    </div>
  </header>
  <div class="finder-page">
    <div class="finder-table" role="grid" aria-label="Files in ${escapeHtml(currentName)}">
      <div class="finder-header" role="row">
        ${fileHeaderButton('name', 'Name')}${fileHeaderButton('modified', 'Date Modified')}${fileHeaderButton('size', 'Size')}${inboxHeader()}
      </div>
      <div class="finder-body">${rows || `<div class="file-empty"><p>This folder is empty.</p>${iconButton('newFolder', 'New Folder', 'data-empty-new-folder')}</div>`}<div class="file-empty search-file-empty" hidden><p>No files match your search.</p></div></div>
    </div>
  </div>`;
}

function inboxCell(file) {
  if (file.type !== 'directory') return '<span class="inbox-cell" role="gridcell"></span>';
  const inbox = file.inbox || {};
  if (!inbox.canConfigure && !inbox.configured) {
    return `<span class="inbox-cell inbox-protected" role="gridcell"><span data-tooltip="${escapeHtml(inbox.reason || 'This folder cannot become an Inbox.')}">--</span></span>`;
  }
  const enabled = Boolean(inbox.enabled);
  const controls = inbox.configured ? `${inbox.instructionsAvailable ? iconButton('instructions', 'Open Instructions', `data-open-inbox-file="${escapeHtml(inbox.instructionsPath)}"`) : ''}${inbox.dataAvailable ? iconButton('data', 'Open Data', `data-open-inbox-data="${escapeHtml(inbox.table)}"`) : ''}${inbox.issues?.length ? iconButton('warning', inbox.reason || 'Inbox needs attention', `data-repair-inbox="${escapeHtml(file.path)}"`) : ''}` : '';
  return `<span class="inbox-cell" role="gridcell">
    <button class="inbox-switch ${enabled ? 'on' : ''}" role="switch" aria-checked="${enabled}" aria-label="${enabled ? 'Turn off' : 'Turn on'} Inbox for ${escapeHtml(file.name)}" data-inbox-toggle="${escapeHtml(file.path)}" data-inbox-configured="${Boolean(inbox.configured)}" data-inbox-has-issues="${Boolean(inbox.issues?.length)}"><span></span></button>
    ${controls}
  </span>`;
}

function inboxHeader() {
  const active = fileSort === 'inbox';
  const arrow = active ? `<svg class="sort-direction ${fileSortDirection}" viewBox="0 0 16 10" aria-hidden="true"><path d="m3 7 5-5 5 5"/></svg>` : '';
  return `<div class="inbox-column-header" role="columnheader" aria-sort="${active ? fileSortDirection : 'none'}"><button data-sort-column="inbox">Inbox${arrow}</button><button class="inbox-info" aria-label="About Inboxes" data-tooltip="About Inboxes" data-inbox-info>i</button></div>`;
}

function fileHeaderButton(sort, label) {
  const active = fileSort === sort;
  const arrow = active ? `<svg class="sort-direction ${fileSortDirection}" viewBox="0 0 16 10" aria-hidden="true"><path d="m3 7 5-5 5 5"/></svg>` : '';
  return `<button role="columnheader" data-sort-column="${sort}" aria-sort="${active ? fileSortDirection : 'none'}">${label}${arrow}</button>`;
}

function sortFiles(files) {
  if (fileSort === 'none') return [...files];
  const direction = fileSortDirection === 'ascending' ? 1 : -1;
  return [...files].sort((left, right) => {
    let comparison = 0;
    if (fileSort === 'name') comparison = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    if (fileSort === 'kind') comparison = fileKind(left).localeCompare(fileKind(right)) || left.name.localeCompare(right.name);
    if (fileSort === 'inbox') {
      const rank = (file) => file.inbox?.enabled ? 0 : file.inbox?.configured ? 1 : file.type === 'directory' && file.inbox?.canConfigure ? 2 : 3;
      comparison = rank(left) - rank(right) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (fileSort === 'modified') comparison = new Date(left.modifiedAt) - new Date(right.modifiedAt);
    if (fileSort === 'size') comparison = left.size - right.size;
    return comparison * direction;
  });
}

function fileKind(file) {
  if (file.type === 'directory') return 'Folder';
  const extension = file.name.includes('.') && !/^\.[^.]+$/.test(file.name) ? file.name.split('.').at(-1).toLowerCase() : '';
  return ({ js: 'JavaScript', mjs: 'JavaScript', json: 'JSON', md: 'Markdown', txt: 'Text', csv: 'CSV', pdf: 'PDF', png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', gif: 'GIF image', svg: 'SVG image', html: 'HTML', css: 'CSS', xlsx: 'Excel spreadsheet', docx: 'Word document', zip: 'ZIP archive' })[extension] || (extension ? `${extension.toUpperCase()} file` : 'Document');
}

function fileIcon(file) {
  if (file.type === 'directory') return '<svg class="finder-icon folder-icon" viewBox="0 0 28 24" aria-hidden="true"><path d="M2.5 5.5h8l2-2h4l2 2h7v15h-23z"/><path d="M2.5 8h23"/></svg>';
  const extension = file.name.includes('.') && !/^\.[^.]+$/.test(file.name) ? file.name.split('.').at(-1).toLowerCase().slice(0, 4) : '';
  return `<span class="finder-icon document-icon"><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M4 1.5h10l6 6v19H4z"/><path d="M14 1.5v6h6"/></svg>${extension ? `<i>${escapeHtml(extension)}</i>` : ''}</span>`;
}

function formatFileDate(value) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today at ${time}` : date.toLocaleDateString([], { year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'short', day: 'numeric' }) + ` at ${time}`;
}

function connectionsView() {
  const cards = connectionsLoading
    ? '<div class="empty compact"><p>Checking your local AI apps…</p></div>'
    : (state.connections || []).map((connection) => `<article class="connection-card" data-search-text="${escapeHtml(`${connection.name} ${connection.status} ${connection.note || ''}`.toLowerCase())}">
        <div class="connection-copy">
          <div class="connection-heading"><h2>${escapeHtml(connection.name)}</h2><span class="connection-status ${connection.connected ? 'connected' : ''}">${escapeHtml(connection.status)}</span></div>
          <p>${escapeHtml(connection.note || (connection.available ? 'Connect Runlet to this AI.' : `Install ${connection.name} to connect it.`))}</p>
        </div>
        <button class="${connection.connected ? 'secondary' : 'primary'} connection-action" data-connection="${connection.id}" data-connected="${connection.connected}" data-action="${escapeHtml(connection.action || (connection.connected ? 'disconnect' : 'connect'))}" ${connection.available ? '' : 'disabled'}>${escapeHtml(connection.actionLabel || (connection.connected ? 'Disconnect' : 'Connect'))}</button>
      </article>`).join('');
  const search = state.connections?.length ? listSearch('connection', connectionSearch, 'Connections') : '';
  return `<div class="page collection-page">${collectionToolbar(search, iconButton('refresh', 'Refresh', 'id="refresh-connections"'))}<div class="action-list connection-list" data-filter-list="connection">${cards}${noSearchResults('connection', 'Connections')}</div></div>`;
}

function fileBreadcrumbs() {
  const parts = filePath === '.' ? [] : filePath.split('/').filter(Boolean);
  const crumbs = [`<button data-file-path="." ${filePath === '.' ? 'aria-current="page"' : ''}>${escapeHtml(state.selected.name)}</button>`];
  parts.forEach((part, index) => {
    const target = parts.slice(0, index + 1).join('/');
    crumbs.push(`<span>›</span><button data-file-path="${escapeHtml(target)}" ${index === parts.length - 1 ? 'aria-current="page"' : ''}>${escapeHtml(part)}</button>`);
  });
  return crumbs.join('');
}

function formatSize(size) {
  return size < 1024 ? `${size} B` : size < 1048576 ? `${Math.round(size / 1024)} KB` : `${(size / 1048576).toFixed(1)} MB`;
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => {
    view = button.dataset.view;
    selectedApp = null;
    selectedPrompt = null;
    selectedDataTable = null;
    dataTable = null;
    render();
    if (view === 'connections') loadConnections();
  });
  document.querySelectorAll('[data-app]').forEach((card) => card.onclick = (event) => {
    if (event.target.closest('button,a')) return;
    selectedApp = state.apps.find((app) => app.slug === card.dataset.app);
    appResults = [];
    appInputValues = {};
    appRunHistory = [];
    appHistoryOpen = false;
    render();
  });
  document.querySelectorAll('[data-open-app]').forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    selectedApp = state.apps.find((app) => app.slug === button.dataset.openApp);
    appResults = [];
    appInputValues = {};
    appRunHistory = [];
    appHistoryOpen = false;
    render();
  });
  document.querySelectorAll('[data-prompt]').forEach((card) => card.onclick = (event) => {
    if (event.target.closest('button,a')) return;
    selectedPrompt = state.prompts.find((prompt) => prompt.slug === card.dataset.prompt);
    render();
  });
  document.querySelectorAll('[data-copy-prompt]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); copyPrompt(button.dataset.copyPrompt); });
  bindListControls('app');
  bindListControls('prompt');
  bindListControls('table');
  bindSimpleListSearch('inbox-data', inboxDataSearch, (value) => { inboxDataSearch = value; });
  bindSimpleListSearch('table-list', tablesSearch, (value) => { tablesSearch = value; });
  bindSimpleListSearch('connection', connectionSearch, (value) => { connectionSearch = value; });
  document.querySelectorAll('[data-delete-kind]').forEach((button) => button.onclick = () => confirmDeleteItem(button.dataset.deleteKind, button.dataset.deleteSlug));
  document.querySelectorAll('[data-file-path]').forEach((button) => button.onclick = () => openFolder(button.dataset.filePath));
  bindFileBrowser();
  document.querySelector('#back')?.addEventListener('click', () => { selectedApp = null; selectedPrompt = null; selectedDataTable = null; dataTable = null; appResults = []; appInputValues = {}; appRunHistory = []; appHistoryOpen = false; render(); });
  document.querySelector('#refresh')?.addEventListener('click', refresh);
  document.querySelector('#workspace-switch')?.addEventListener('click', workspaceSwitcher);
  const workspacePath = document.querySelector('.workspace-breadcrumb');
  if (workspacePath) requestAnimationFrame(() => { workspacePath.scrollLeft = workspacePath.scrollWidth; });
  document.querySelectorAll('[data-info-text]').forEach((button) => button.addEventListener('click', () => infoModal(button.dataset.infoText)));
  document.querySelector('#refresh-connections')?.addEventListener('click', loadConnections);
  document.querySelectorAll('[data-connection]').forEach((button) => button.onclick = () => changeConnection(button));
  document.querySelector('#prompt-form')?.addEventListener('submit', savePrompt);
  document.querySelector('#app-run-form')?.addEventListener('submit', runApp);
  document.querySelector('#app-run-history')?.addEventListener('click', toggleAppRunHistory);
  document.querySelector('#close-run-history')?.addEventListener('click', () => { appHistoryOpen = false; render(); });
  bindDataBrowser();
  document.querySelectorAll('[data-meta-field]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); element.blur(); }
    });
    element.addEventListener('blur', saveMetadata);
  });
}

async function loadDataTable(tableName) {
  try {
    const loaded = await api(`/api/data/tables/${encodeURIComponent(tableName)}?workspaceId=${encodeURIComponent(state.selected.id)}&limit=5000`);
    if (selectedDataTable !== tableName) return;
    dataTable = loaded;
    const summary = state.dataTables.find((table) => table.table_name === tableName);
    if (summary) summary.rowCount = loaded.rowCount;
    if (view === 'data' || view === 'tables') render();
  } catch (error) { toast(error.message, true); }
}

function bindDataBrowser() {
  document.querySelectorAll('[data-data-file-path]').forEach((button) => button.addEventListener('click', () => void openFolder(button.dataset.dataFilePath, 'files')));
  document.querySelector('[data-tables-home]')?.addEventListener('click', () => { selectedDataTable = null; dataTable = null; render(); });
  document.querySelector('#new-data-table')?.addEventListener('click', newDataTableModal);
  document.querySelector('[data-delete-data-table]')?.addEventListener('click', confirmDeleteDataTable);
  document.querySelectorAll('[data-data-table]').forEach((card) => card.onclick = (event) => {
    if (event.target.closest('button,a')) return;
    openDataTable(card.dataset.dataTable);
  });
  document.querySelectorAll('[data-open-data-table]').forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    openDataTable(button.dataset.openDataTable);
  });
  document.querySelectorAll('[data-data-sort]').forEach((button) => button.onclick = () => {
    const column = button.dataset.dataSort;
    if (dataSortColumn === column) dataSortDirection = dataSortDirection === 'ascending' ? 'descending' : 'ascending';
    else { dataSortColumn = column; dataSortDirection = 'ascending'; }
    render();
  });
  const search = document.querySelector('#data-search');
  search?.addEventListener('input', () => {
    dataSearch = search.value;
    applyDataSearch();
  });
  document.querySelector('#add-data-row')?.addEventListener('click', addDataRow);
  document.querySelector('#add-data-column')?.addEventListener('click', addColumnModal);
  document.querySelectorAll('[data-rename-data-column]').forEach((button) => button.onclick = () => renameColumnModal(button.dataset.renameDataColumn));
  document.querySelectorAll('[data-delete-data-row]').forEach((button) => button.onclick = () => deleteDataRow(button.dataset.deleteDataRow));
  document.querySelectorAll('[data-delete-data-column]').forEach((button) => button.onclick = () => deleteDataColumn(button.dataset.deleteDataColumn));
  document.querySelectorAll('[data-move-data-column]').forEach((button) => button.onclick = () => moveDataColumn(button.dataset.dataColumnName, button.dataset.moveDataColumn));
  document.querySelectorAll('[data-data-row]').forEach((cell) => {
    cell.addEventListener('blur', () => void saveDataCell(cell));
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const next = cell.closest('tr')?.nextElementSibling?.querySelector(`[data-data-column="${CSS.escape(cell.dataset.dataColumn)}"]`);
      cell.blur();
      next?.focus();
    });
    cell.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!/[\t,\r\n]/.test(text)) return;
      event.preventDefault();
      void pasteDataCells(cell, text);
    });
  });
}

function newDataTableModal() {
  modal(`<div class="modal-head"><h2>New Table</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div><form id="new-data-table-form"><label>Table name<input name="name" required autocomplete="off" placeholder="For example, Suppliers"></label><div class="confirmation-actions"><button type="button" class="secondary modal-close-action">Cancel</button><button class="primary" type="submit">Create Table</button></div></form>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('#new-data-table-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const created = await api('/api/data/tables', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, name: new FormData(event.currentTarget).get('name') }) });
      state.dataTables.push(created);
      closeModal();
      openDataTable(created.table_name);
    } catch (error) { button.disabled = false; toast(error.message, true); }
  };
}

function openDataTable(tableName) {
  selectedDataTable = tableName;
  dataTable = null;
  dataSearch = '';
  dataSortColumn = null;
  render();
  void loadDataTable(tableName);
}

function applyDataSearch() {
  const query = dataSearch.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-data-row-record]').forEach((row) => {
    const matches = !query || row.textContent.toLowerCase().includes(query);
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  const first = document.querySelector('.data-visible-count');
  if (first) first.textContent = `${visible}${query ? ` of ${dataTable?.rowCount || 0}` : ''} ${visible === 1 ? 'row' : 'rows'}`;
}

async function saveDataCell(cell) {
  const value = cell.textContent.replace(/\r?\n/g, ' ').trim();
  if (value === cell.dataset.original) return;
  try {
    await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/rows/${encodeURIComponent(cell.dataset.dataRow)}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: state.selected.id, column: cell.dataset.dataColumn, value }),
    });
    const row = dataTable?.rows.find((item) => String(item.id) === String(cell.dataset.dataRow));
    if (row) row.values[cell.dataset.dataColumn] = value;
    cell.dataset.original = value;
    cell.classList.add('saved');
    setTimeout(() => cell.classList.remove('saved'), 500);
  } catch (error) {
    cell.textContent = cell.dataset.original;
    toast(error.message, true);
  }
}

async function pasteDataCells(startCell, text) {
  const matrix = parsePastedGrid(text);
  const rows = [...document.querySelectorAll('[data-data-row-record]:not([hidden])')];
  const startRow = rows.indexOf(startCell.closest('tr'));
  const startColumn = dataTable.columns.findIndex((column) => column.name === startCell.dataset.dataColumn);
  const saves = [];
  matrix.forEach((values, rowOffset) => values.forEach((value, columnOffset) => {
    const row = rows[startRow + rowOffset];
    const column = dataTable.columns[startColumn + columnOffset];
    const cell = row?.querySelector(`[data-data-column="${CSS.escape(column?.name || '')}"]`);
    if (!cell || !column) return;
    cell.textContent = value;
    saves.push(saveDataCell(cell));
  }));
  await Promise.all(saves);
}

function parsePastedGrid(text) {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (source.includes('\t')) return source.split('\n').map((line) => line.split('\t'));
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += character;
  }
  row.push(value);
  rows.push(row);
  return rows;
}

async function addDataRow() {
  try {
    await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/rows`, { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, values: {} }) });
    await loadDataTable(selectedDataTable);
    document.querySelector('[data-data-row-record]:last-child [data-data-row]')?.focus();
  } catch (error) { toast(error.message, true); }
}

async function deleteDataRow(rowId) {
  if (!window.confirm('Delete this row?')) return;
  try {
    await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/rows/${encodeURIComponent(rowId)}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: state.selected.id }) });
    await loadDataTable(selectedDataTable);
  } catch (error) { toast(error.message, true); }
}

function addColumnModal() {
  modal(`<div class="modal-head"><h2>Add column</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <form id="add-column-form"><label>Column name<input name="name" required autocomplete="off" placeholder="For example, notes"></label><div class="confirmation-actions"><button type="button" class="secondary modal-close-action">Cancel</button><button class="primary" type="submit">Add column</button></div></form>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  const form = document.querySelector('#add-column-form');
  form.querySelector('input').focus();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    try {
      await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/columns`, { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, name }) });
      closeModal();
      await loadDataTable(selectedDataTable);
      toast(`${name} added.`);
    } catch (error) { toast(error.message, true); }
  };
}

function renameColumnModal(column) {
  modal(`<div class="modal-head"><h2>Rename column</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <form id="rename-column-form"><label>Column name<input name="name" required autocomplete="off" value="${escapeHtml(column)}"></label><div class="confirmation-actions"><button type="button" class="secondary modal-close-action">Cancel</button><button class="primary" type="submit">Rename</button></div></form>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  const form = document.querySelector('#rename-column-form');
  const input = form.querySelector('input');
  input.focus();
  input.select();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    try {
      await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/columns/${encodeURIComponent(column)}`, { method: 'PATCH', body: JSON.stringify({ workspaceId: state.selected.id, name }) });
      if (dataSortColumn === column) dataSortColumn = name;
      closeModal();
      await loadDataTable(selectedDataTable);
      toast(`${column} renamed to ${name}.`);
    } catch (error) { toast(error.message, true); }
  };
}

async function deleteDataColumn(column) {
  if (!window.confirm(`Delete the “${column}” column and all of its values?`)) return;
  try {
    await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/columns/${encodeURIComponent(column)}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: state.selected.id }) });
    if (dataSortColumn === column) dataSortColumn = null;
    await loadDataTable(selectedDataTable);
  } catch (error) { toast(error.message, true); }
}

async function moveDataColumn(column, direction) {
  try {
    await api(`/api/data/tables/${encodeURIComponent(selectedDataTable)}/columns/${encodeURIComponent(column)}`, { method: 'PATCH', body: JSON.stringify({ workspaceId: state.selected.id, direction }) });
    await loadDataTable(selectedDataTable);
  } catch (error) { toast(error.message, true); }
}

function bindSimpleListSearch(kind, value, save) {
  const input = document.querySelector(`#${kind}-search`);
  if (!input) return;
  const apply = () => {
    save(input.value);
    applyListFilter(kind, input.value);
  };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    input.value = '';
    apply();
  });
  input.value = value;
  applyListFilter(kind, value);
}

function bindListControls(kind) {
  const plural = `${kind}s`;
  const input = document.querySelector(`#${kind}-search`);
  if (input) {
    input.addEventListener('input', () => {
      if (kind === 'app') appSearch = input.value;
      else promptSearch = input.value;
      applyListFilter(kind, input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      input.value = '';
      if (kind === 'app') appSearch = '';
      else promptSearch = '';
      applyListFilter(kind, '');
    });
    applyListFilter(kind, input.value);
  }

  const list = document.querySelector(`[data-order-list="${plural}"]`);
  if (!list) return;
  const dragSurface = list.closest('.shell');
  let draggedCard = null;
  let moved = false;
  let scrollSpeed = 0;
  let scrollFrame = null;
  let dragImage = null;

  const moveAtScrollEdge = () => {
    if (!draggedCard || !scrollSpeed) return;
    const bounds = list.getBoundingClientRect();
    const visibleCards = [...list.querySelectorAll('[data-order-item]:not([hidden])')].filter((card) => {
      if (card === draggedCard) return false;
      const cardBounds = card.getBoundingClientRect();
      return cardBounds.bottom >= bounds.top && cardBounds.top <= bounds.bottom;
    });
    const target = scrollSpeed < 0 ? visibleCards[0] : visibleCards.at(-1);
    if (!target) return;
    const reference = scrollSpeed < 0 ? target : target.nextSibling;
    if (reference === draggedCard || draggedCard.nextSibling === reference) return;
    animateCardMove(list, draggedCard, reference);
    moved = true;
  };

  const scrollList = () => {
    if (!draggedCard || !scrollSpeed) {
      scrollFrame = null;
      return;
    }
    list.scrollTop += scrollSpeed;
    moveAtScrollEdge();
    scrollFrame = requestAnimationFrame(scrollList);
  };

  const updateAutoScroll = (pointerY) => {
    const bounds = list.getBoundingClientRect();
    const edge = Math.min(84, bounds.height / 4);
    if (pointerY < bounds.top + edge) {
      scrollSpeed = -Math.min(14, Math.max(2, (bounds.top + edge - pointerY) / 6));
    } else if (pointerY > bounds.bottom - edge) {
      scrollSpeed = Math.min(14, Math.max(2, (pointerY - bounds.bottom + edge) / 6));
    } else {
      scrollSpeed = 0;
    }
    if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(scrollList);
  };

  const finishDrag = () => {
    if (!draggedCard) return;
    draggedCard.classList.remove('dragging');
    draggedCard.draggable = false;
    dragImage?.remove();
    dragImage = null;
    scrollSpeed = 0;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    if (moved) void saveListOrder(plural, list);
    draggedCard = null;
  };

  list.querySelectorAll('[data-drag-kind]').forEach((handle) => {
    const card = handle.closest('[data-order-item]');
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('pointerdown', () => {
      if (!list.classList.contains('searching')) card.draggable = true;
    });
    card.addEventListener('dragstart', (event) => {
      if (list.classList.contains('searching')) {
        event.preventDefault();
        return;
      }
      draggedCard = card;
      moved = false;
      dragImage = document.createElement('span');
      dragImage.className = 'invisible-drag-image';
      document.body.append(dragImage);
      event.dataTransfer.setDragImage(dragImage, 0, 0);
      draggedCard.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', handle.dataset.dragSlug);
    });
    card.addEventListener('dragend', finishDrag);
  });
  list.querySelectorAll('[data-order-item]').forEach((card) => {
    card.addEventListener('dragover', (event) => {
      if (!draggedCard || card === draggedCard || card.hidden) return;
      event.preventDefault();
      const after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      const reference = after ? card.nextSibling : card;
      if (reference === draggedCard || draggedCard.nextSibling === reference) return;
      animateCardMove(list, draggedCard, reference);
      moved = true;
    });
  });
  dragSurface?.addEventListener('dragover', (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    updateAutoScroll(event.clientY);
  });
  dragSurface?.addEventListener('drop', (event) => {
    if (draggedCard) event.preventDefault();
  });
}

function animateCardMove(list, draggedCard, reference) {
  const cards = [...list.querySelectorAll('[data-order-item]:not([hidden])')];
  const previousTops = new Map(cards.map((card) => [card, card.getBoundingClientRect().top]));
  list.insertBefore(draggedCard, reference);
  for (const card of cards) {
    if (card === draggedCard) continue;
    const movement = previousTops.get(card) - card.getBoundingClientRect().top;
    if (!movement) continue;
    card.animate([{ transform: `translateY(${movement}px)` }, { transform: 'translateY(0)' }], { duration: 170, easing: 'ease-out' });
  }
}

function applyListFilter(kind, query) {
  const normalized = String(query || '').trim().toLowerCase();
  const list = document.querySelector(`[data-filter-list="${kind}"]`);
  list?.classList.toggle('searching', Boolean(normalized));
  let matches = 0;
  list?.querySelectorAll('[data-search-text]').forEach((card) => {
    card.hidden = normalized && !card.dataset.searchText.includes(normalized);
    if (!card.hidden) matches += 1;
  });
  const empty = document.querySelector(`[data-search-empty="${kind}"]`);
  if (empty) empty.hidden = matches > 0;
}

async function saveListOrder(kind, list) {
  const visibleOrder = [...list.querySelectorAll('[data-order-item]:not([hidden])')].map((card) => card.dataset.orderItem);
  const visible = new Set(visibleOrder);
  let visibleIndex = 0;
  const items = kind === 'tables' ? state.dataTables.filter((item) => item.source_kind === 'table') : state[kind];
  const itemId = (item) => kind === 'tables' ? item.table_name : item.slug;
  const slugs = items.map((item) => visible.has(itemId(item)) ? visibleOrder[visibleIndex++] : itemId(item));
  try {
    const ordered = await api(`/api/order/${kind}`, { method: 'PUT', body: JSON.stringify({ workspaceId: state.selected.id, slugs }) });
    if (kind === 'tables') state.dataTables = ordered;
    else state[kind] = ordered;
    render();
  } catch (error) {
    toast(error.message, true);
    await refresh();
  }
}

async function loadConnections() {
  connectionsLoading = true;
  render();
  try {
    state.connections = await api('/api/connections');
  } catch (error) { toast(error.message, true); }
  connectionsLoading = false;
  render();
}

async function changeConnection(button) {
  const provider = button.dataset.connection;
  const action = button.dataset.action;
  const disconnecting = action === 'disconnect';
  button.disabled = true;
  button.textContent = action === 'install' ? 'Opening…' : disconnecting ? 'Disconnecting…' : 'Connecting…';
  try {
    const connection = await api(`/api/connections/${encodeURIComponent(provider)}`, { method: disconnecting ? 'DELETE' : 'POST' });
    toast(connection.message || (connection.connected ? `${connection.name} connected.` : `${connection.name} disconnected.`));
    await loadConnections();
  } catch (error) {
    toast(error.message, true);
    await loadConnections();
  }
}

async function openFolder(path, targetView = view) {
  try {
    const nextPath = path || '.';
    const files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(nextPath)}`);
    if (nextPath !== filePath) {
      fileHistory = fileHistory.slice(0, fileHistoryIndex + 1);
      fileHistory.push(nextPath);
      fileHistoryIndex = fileHistory.length - 1;
    }
    view = targetView;
    selectedApp = null;
    selectedPrompt = null;
    selectedDataTable = null;
    dataTable = null;
    filePath = nextPath;
    state.files = files;
    selectedFilePath = null;
    fileSearch = '';
    render();
  } catch (error) { toast(error.message, true); }
}

async function visitFileHistory(index) {
  const nextPath = fileHistory[index];
  if (nextPath === undefined) return;
  try {
    const files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(nextPath)}`);
    fileHistoryIndex = index;
    filePath = nextPath;
    state.files = files;
    selectedFilePath = null;
    fileSearch = '';
    render();
  } catch (error) { toast(error.message, true); }
}

function bindFileBrowser() {
  const breadcrumbs = document.querySelector('.breadcrumbs');
  const breadcrumbTargets = [...document.querySelectorAll('.breadcrumbs [data-file-path]')];
  if (breadcrumbs) requestAnimationFrame(() => { breadcrumbs.scrollLeft = breadcrumbs.scrollWidth; });
  const search = document.querySelector('#file-search');
  if (search) {
    search.addEventListener('input', () => {
      fileSearch = search.value;
      applyFileFilter(search.value);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      search.value = '';
      fileSearch = '';
      applyFileFilter('');
    });
    applyFileFilter(search.value);
  }
  document.querySelector('#files-back')?.addEventListener('click', () => visitFileHistory(fileHistoryIndex - 1));
  document.querySelector('#files-forward')?.addEventListener('click', () => visitFileHistory(fileHistoryIndex + 1));
  document.querySelector('#new-folder')?.addEventListener('click', newFolderModal);
  document.querySelector('[data-empty-new-folder]')?.addEventListener('click', newFolderModal);
  document.querySelector('[data-inbox-info]')?.addEventListener('click', () => infoModal('Inboxes are folders Runlet can process. Loose files wait in the folder. Completed files move to processed, and uncertain files move to needs-review.\n\nYou can ask your AI: “Use Runlet to edit the instructions for an Inbox,” or ask it to work with that Inbox’s data.'));
  document.querySelectorAll('[data-inbox-toggle]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleInbox(button.dataset.inboxToggle, button.getAttribute('aria-checked') === 'true', button.dataset.inboxConfigured === 'true', button.dataset.inboxHasIssues === 'true');
  }));
  document.querySelectorAll('[data-open-inbox-file]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    void openFile(button.dataset.openInboxFile);
  }));
  document.querySelectorAll('[data-open-inbox-data]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    view = 'data';
    selectedApp = null;
    selectedPrompt = null;
    selectedDataTable = button.dataset.openInboxData;
    dataTable = null;
    dataSearch = '';
    render();
    void loadDataTable(selectedDataTable);
  }));
  document.querySelectorAll('[data-repair-inbox]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    inboxRepairModal(button.dataset.repairInbox);
  }));
  document.querySelectorAll('.inbox-cell button').forEach((button) => {
    const row = button.closest('[data-file-entry]');
    const restoreDrag = () => { if (row) row.draggable = true; };
    button.addEventListener('pointerdown', () => {
      if (row) row.draggable = false;
      document.addEventListener('pointerup', restoreDrag, { once: true });
      document.addEventListener('pointercancel', restoreDrag, { once: true });
    });
  });
  document.querySelectorAll('[data-file-sort]').forEach((button) => button.onclick = () => {
    fileSort = button.dataset.fileSort;
    fileSortDirection = 'ascending';
    render();
  });
  document.querySelectorAll('[data-sort-column]').forEach((button) => button.onclick = () => {
    const next = button.dataset.sortColumn;
    if (fileSort === next) fileSortDirection = fileSortDirection === 'ascending' ? 'descending' : 'ascending';
    else { fileSort = next; fileSortDirection = 'ascending'; }
    render();
  });

  let draggedPath = null;
  let fileDragPreview = null;
  const hasDroppedFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  const clearFileDragState = () => {
    breadcrumbs?.classList.remove('drag-active');
    document.querySelectorAll('.drop-target, .drop-available').forEach((item) => item.classList.remove('drop-target', 'drop-available'));
    fileDragPreview?.remove();
    fileDragPreview = null;
  };
  breadcrumbTargets.forEach((button) => {
    button.addEventListener('dragover', (event) => {
      if (!hasDroppedFiles(event) && (!draggedPath || !canCopyFileToFolder(draggedPath, button.dataset.filePath))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      breadcrumbs?.classList.add('drag-active');
      breadcrumbTargets.forEach((item) => item.classList.toggle('drop-target', item === button));
    });
    button.addEventListener('dragleave', (event) => {
      if (!button.contains(event.relatedTarget)) button.classList.remove('drop-target');
    });
    button.addEventListener('drop', (event) => {
      const externalFiles = [...(event.dataTransfer?.files || [])];
      if (!externalFiles.length && (!draggedPath || !canCopyFileToFolder(draggedPath, button.dataset.filePath))) return;
      event.preventDefault();
      event.stopPropagation();
      const source = draggedPath;
      const destination = button.dataset.filePath;
      draggedPath = null;
      clearFileDragState();
      if (externalFiles.length) void uploadDroppedFiles(externalFiles, destination);
      else void copyFileToFolder(source, destination);
    });
  });
  breadcrumbs?.addEventListener('dragover', (event) => {
    if (!draggedPath) return;
    const bounds = breadcrumbs.getBoundingClientRect();
    const edge = Math.min(34, bounds.width / 4);
    if (event.clientX < bounds.left + edge) breadcrumbs.scrollLeft -= 16;
    else if (event.clientX > bounds.right - edge) breadcrumbs.scrollLeft += 16;
  });
  document.querySelectorAll('[data-file-entry]').forEach((row) => {
    row.addEventListener('click', () => {
      selectedFilePath = row.dataset.fileEntry;
      document.querySelectorAll('[data-file-entry]').forEach((item) => item.classList.toggle('selected', item === row));
    });
    row.addEventListener('dblclick', () => row.dataset.fileType === 'directory' ? openFolder(row.dataset.fileEntry) : openFile(row.dataset.fileEntry));
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      row.dataset.fileType === 'directory' ? openFolder(row.dataset.fileEntry) : openFile(row.dataset.fileEntry);
    });
    row.addEventListener('dragstart', (event) => {
      hideQuickTooltip();
      draggedPath = row.dataset.fileEntry;
      fileDragPreview = document.createElement('div');
      fileDragPreview.className = 'file-drag-preview';
      const icon = row.querySelector('.finder-icon')?.cloneNode(true);
      const label = document.createElement('span');
      label.textContent = row.querySelector('.file-name')?.textContent || draggedPath.split('/').at(-1);
      if (icon) fileDragPreview.append(icon);
      fileDragPreview.append(label);
      document.body.append(fileDragPreview);
      event.dataTransfer.setDragImage(fileDragPreview, 16, 16);
      row.classList.add('dragging');
      breadcrumbs?.classList.add('drag-active');
      breadcrumbTargets.forEach((button) => button.classList.toggle('drop-available', canCopyFileToFolder(draggedPath, button.dataset.filePath)));
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', draggedPath);
    });
    row.addEventListener('dragend', () => {
      draggedPath = null;
      row.classList.remove('dragging');
      clearFileDragState();
    });
    if (row.dataset.fileType !== 'directory') return;
    row.addEventListener('dragover', (event) => {
      if (!hasDroppedFiles(event) && (!draggedPath || !canCopyFileToFolder(draggedPath, row.dataset.fileEntry))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove('drop-target');
      const externalFiles = [...(event.dataTransfer?.files || [])];
      if (externalFiles.length) void uploadDroppedFiles(externalFiles, row.dataset.fileEntry);
      else if (draggedPath && canCopyFileToFolder(draggedPath, row.dataset.fileEntry)) void copyFileToFolder(draggedPath, row.dataset.fileEntry);
    });
  });
  const body = document.querySelector('.finder-body');
  body?.addEventListener('dragover', (event) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    body.classList.add('drop-target');
  });
  body?.addEventListener('dragleave', (event) => { if (!body.contains(event.relatedTarget)) body.classList.remove('drop-target'); });
  body?.addEventListener('drop', (event) => {
    const externalFiles = [...(event.dataTransfer?.files || [])];
    if (!externalFiles.length) return;
    event.preventDefault();
    body.classList.remove('drop-target');
    void uploadDroppedFiles(externalFiles, filePath);
  });
}

function dismissFileTransientState(event) {
  document.querySelectorAll('.data-menu[open]').forEach((menu) => { if (!menu.contains(event.target)) menu.removeAttribute('open'); });
  const sortMenu = document.querySelector('.sort-menu[open]');
  if (sortMenu && !sortMenu.contains(event.target)) sortMenu.removeAttribute('open');
  if (!selectedFilePath || event.target.closest('[data-file-entry]')) return;
  selectedFilePath = null;
  document.querySelectorAll('[data-file-entry].selected').forEach((row) => row.classList.remove('selected'));
}

function infoModal(text) {
  const paragraphs = String(text || '').split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  modal(`<button class="modal-close info-close" aria-label="Close" data-tooltip="Close">×</button><div class="info-copy">${paragraphs}</div>`, { className: 'info-modal', backdropClass: 'info-backdrop', clickAway: true });
}

function hideQuickTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  tooltipTarget = null;
  document.querySelector('.quick-tooltip')?.remove();
}

function showQuickTooltip(target) {
  if (!document.contains(target)) return hideQuickTooltip();
  document.querySelector('.quick-tooltip')?.remove();
  const tooltip = document.createElement('div');
  tooltip.className = 'quick-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.textContent = target.dataset.tooltip;
  document.body.append(tooltip);
  const targetBounds = target.getBoundingClientRect();
  const tooltipBounds = tooltip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - tooltipBounds.width - 8, Math.max(8, targetBounds.left + (targetBounds.width - tooltipBounds.width) / 2));
  const below = targetBounds.bottom + 7;
  const top = below + tooltipBounds.height <= window.innerHeight - 8 ? below : targetBounds.top - tooltipBounds.height - 7;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function applyFileFilter(query) {
  const normalized = String(query || '').trim().toLowerCase();
  let matches = 0;
  document.querySelectorAll('[data-file-entry]').forEach((row) => {
    row.hidden = Boolean(normalized) && !row.dataset.searchText.includes(normalized);
    if (!row.hidden) matches += 1;
  });
  const empty = document.querySelector('.search-file-empty');
  if (empty) empty.hidden = !normalized || matches > 0;
  const count = document.querySelector('[data-file-count]');
  if (count) count.textContent = normalized ? `${matches} of ${state.files.length} items` : `${state.files.length} ${state.files.length === 1 ? 'item' : 'items'}`;
}

async function copyFileToFolder(from, folder) {
  const name = from.split('/').at(-1);
  const to = folder === '.' ? name : `${folder}/${name}`;
  if (!canCopyFileToFolder(from, folder)) {
    toast('That item is already there or cannot be copied into itself.', true);
    return;
  }
  try {
    await api('/api/files/copy', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, from, to }) });
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
    render();
    toast(`${name} copied.`);
  } catch (error) { toast(error.message, true); }
}

function canCopyFileToFolder(from, folder) {
  const name = from.split('/').at(-1);
  const to = folder === '.' ? name : `${folder}/${name}`;
  return from !== to && !folder.startsWith(`${from}/`);
}

async function uploadDroppedFiles(files, folder) {
  try {
    const prepared = await Promise.all(files.map(async (file) => ({ name: file.name, data: await droppedFileBase64(file) })));
    const result = await api('/api/files/upload', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, folder, files: prepared }) });
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
    render();
    toast(`${result.copied.length} ${result.copied.length === 1 ? 'file' : 'files'} copied.`);
  } catch (error) { toast(error.message, true); }
}

function droppedFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

async function reloadCurrentFiles() {
  state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
  render();
}

async function toggleInbox(path, enabled, configured, hasIssues) {
  if (enabled) {
    try {
      await api('/api/inboxes', { method: 'PATCH', body: JSON.stringify({ workspaceId: state.selected.id, path, enabled: false }) });
      await reloadCurrentFiles();
      toast(`${path.split('/').at(-1)} is no longer an active Inbox.`);
    } catch (error) { toast(error.message, true); }
    return;
  }
  if (!configured) return inboxSetupModal(path);
  if (hasIssues) return inboxRepairModal(path);
  try {
    await api('/api/inboxes', { method: 'PATCH', body: JSON.stringify({ workspaceId: state.selected.id, path, enabled: true }) });
    await reloadCurrentFiles();
    toast(`${path.split('/').at(-1)} is now an active Inbox.`);
  } catch (error) { toast(error.message, true); }
}

function inboxSetupModal(path) {
  const name = path.split('/').at(-1);
  modal(`<div class="modal-head"><h2>Make ${escapeHtml(name)} an Inbox?</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <div class="inbox-setup"><p>Runlet will give this folder an editable data table and add:</p><ul class="inbox-file-list"><li><code>runlet.json</code></li><li><code>INSTRUCTIONS.md</code></li><li><code>processed/</code></li><li><code>needs-review/</code></li></ul><div class="confirmation-actions"><button class="secondary modal-close-action">Cancel</button><button class="primary" data-confirm-inbox>Create Inbox</button></div></div>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('[data-confirm-inbox]').onclick = (event) => performInboxSetup(path, false, event.currentTarget);
}

function inboxRepairModal(path) {
  const file = state.files.find((item) => item.path === path);
  const inbox = file?.inbox;
  if (!inbox?.issues?.length) return;
  const repairable = Boolean(inbox.repairable);
  modal(`<div class="modal-head"><h2>Inbox needs attention</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <div class="inbox-setup"><p>${escapeHtml(inbox.issues.map((issue) => issue.reason).join(' '))}</p><p>${repairable ? 'Runlet can recreate the missing items without replacing anything else.' : 'Rename the conflicting item, then refresh and try again.'}</p><div class="confirmation-actions"><button class="secondary modal-close-action">Close</button>${repairable ? '<button class="primary" data-repair-confirm>Repair Inbox</button>' : ''}</div></div>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('[data-repair-confirm]')?.addEventListener('click', (event) => performInboxSetup(path, true, event.currentTarget));
}

async function performInboxSetup(path, repair, button) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = repair ? 'Repairing…' : 'Creating…';
  try {
    await api('/api/inboxes', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, path, repair }) });
    closeModal();
    await reloadCurrentFiles();
    toast(`${path.split('/').at(-1)} is ready as an Inbox.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = old;
    toast(error.message, true);
  }
}

function newFolderModal() {
  let suggestion = 'New Folder';
  let number = 2;
  const names = new Set(state.files.map((file) => file.name.toLowerCase()));
  while (names.has(suggestion.toLowerCase())) suggestion = `New Folder ${number++}`;
  modal(`<div class="modal-head"><h2>New Folder</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <form id="new-folder-form"><label>Folder name<input name="name" required value="${escapeHtml(suggestion)}" autocomplete="off"></label><div class="confirmation-actions"><button type="button" class="secondary modal-close-action">Cancel</button><button class="primary" type="submit">Create</button></div></form>`);
  const input = document.querySelector('#new-folder-form input');
  input.select();
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('#new-folder-form').onsubmit = async (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name').trim();
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) return toast('Use a folder name without slashes.', true);
    const path = filePath === '.' ? name : `${filePath}/${name}`;
    try {
      await api('/api/files/folder', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, path }) });
      closeModal();
      state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
      render();
      toast(`${name} created.`);
    } catch (error) { toast(error.message, true); }
  };
}

async function openFile(path) {
  try {
    await api('/api/files/open', { method: 'POST', body: JSON.stringify({ workspaceId: state.selected.id, path }) });
    toast(`Opened ${path.split('/').at(-1)}.`);
  } catch (error) { toast(error.message, true); }
}

async function loadAppResults() {
  if (!selectedApp || !selectedApp.results.length) return;
  const slug = selectedApp.slug;
  try {
    appResults = await api(`/api/apps/${encodeURIComponent(slug)}/results?workspaceId=${encodeURIComponent(state.selected.id)}`);
    if (selectedApp?.slug === slug) render();
  } catch (error) { toast(error.message, true); }
}

async function loadAppRunHistory() {
  if (!selectedApp) return;
  const slug = selectedApp.slug;
  appRunHistory = await api(`/api/apps/${encodeURIComponent(slug)}/runs?workspaceId=${encodeURIComponent(state.selected.id)}`);
}

async function toggleAppRunHistory() {
  appHistoryOpen = !appHistoryOpen;
  if (appHistoryOpen) {
    try { await loadAppRunHistory(); }
    catch (error) { toast(error.message, true); }
  }
  render();
}

async function runApp(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[data-run-app]');
  const slug = button.dataset.runApp;
  const hasPage = selectedApp?.slug === slug && selectedApp.hasPage;
  const viewWindow = hasPage ? window.open('about:blank', '_blank') : null;
  if (viewWindow) {
    viewWindow.opener = null;
    viewWindow.document.title = `${selectedApp.name} — Running`;
    viewWindow.document.body.innerHTML = '<p style="font: 15px system-ui; padding: 24px; color: #555">Running App…</p>';
  }
  appInputValues = Object.fromEntries(new FormData(form));
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const response = await api(`/api/apps/${encodeURIComponent(slug)}/run`, { method:'POST', body: JSON.stringify({ workspaceId: state.selected.id, input: appInputValues }) });
    await refresh();
    if (appHistoryOpen) { await loadAppRunHistory(); render(); }
    if (hasPage) {
      if (viewWindow) viewWindow.location.replace(`/app-view/${state.selected.id}/${encodeURIComponent(slug)}`);
      toast(viewWindow ? (response.logs?.at(-1) || 'App finished. Its page opened in a new tab.') : 'App finished. Use Open App to view it.');
    } else {
      await loadAppResults();
      toast(response.logs?.at(-1) || 'App finished.');
    }
  } catch (error) {
    if (viewWindow) viewWindow.close();
    button.disabled = false;
    button.textContent = old;
    appHistoryOpen = true;
    try { await loadAppRunHistory(); } catch {}
    render();
    toast('Something went wrong. Check Run history.', true);
  }
}

async function saveMetadata(event) {
  const element = event.currentTarget;
  const kind = element.dataset.metaKind;
  const field = element.dataset.metaField;
  const item = kind === 'app' ? selectedApp : selectedPrompt;
  const value = element.textContent.trim();
  if (!item || value === item[field]) return;
  try {
    const updated = await api(`/api/${kind}s/${encodeURIComponent(item.slug)}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: state.selected.id, [field]: value }),
    });
    if (kind === 'app') selectedApp = updated;
    else selectedPrompt = updated;
    await refresh();
    toast(`${field === 'name' ? 'Name' : 'Description'} saved.`);
  } catch (error) {
    element.textContent = item[field];
    toast(error.message, true);
  }
}

async function copyPrompt(slug) {
  const prompt = state.prompts.find((item) => item.slug === slug);
  if (!prompt) return;
  try {
    await navigator.clipboard.writeText(prompt.content);
    toast('Prompt copied.');
  } catch (error) { toast(error.message, true); }
}

async function savePrompt(event) {
  event.preventDefault();
  const content = new FormData(event.currentTarget).get('content');
  try {
    const updated = await api(`/api/prompts/${encodeURIComponent(selectedPrompt.slug)}`, { method: 'PUT', body: JSON.stringify({ workspaceId: state.selected.id, content }) });
    selectedPrompt = updated;
    await refresh();
    toast('Prompt saved.');
  } catch (error) { toast(error.message, true); }
}

function confirmDeleteDataTable() {
  if (!dataTable || dataTable.source_kind !== 'table') return;
  modal(`<div class="modal-head"><h2>Delete Table?</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <div class="delete-confirmation">
      <p><b>${escapeHtml(dataTable.display_name)}</b></p>
      <p>Every row and column in this Table will be permanently deleted.</p>
      <div class="confirmation-actions"><button class="secondary modal-close-action">Cancel</button><button class="danger-button" data-confirm-delete-table>Delete Table</button></div>
    </div>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('[data-confirm-delete-table]').onclick = (event) => deleteDataTable(event.currentTarget);
}

async function deleteDataTable(button) {
  if (!dataTable || dataTable.source_kind !== 'table') return;
  const name = dataTable.display_name;
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    await api(`/api/data/tables/${encodeURIComponent(dataTable.table_name)}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: state.selected.id }) });
    selectedDataTable = null;
    dataTable = null;
    closeModal();
    await refresh();
    toast(`${name} was deleted.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Delete Table';
    toast(error.message, true);
  }
}

function confirmDeleteItem(kind, slug) {
  const item = kind === 'app' ? selectedApp : selectedPrompt;
  if (!item || item.slug !== slug) return;
  const label = kind === 'app' ? 'App' : 'Prompt';
  const detail = kind === 'app'
    ? 'Its inputs, outputs, and generated files will also be permanently deleted.'
    : 'Its saved instructions will be permanently deleted.';
  modal(`<div class="modal-head"><h2>Delete ${label}?</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <div class="delete-confirmation">
      <p><b>${escapeHtml(item.name)}</b></p>
      <p>${detail}</p>
      <div class="confirmation-actions"><button class="secondary modal-close-action">Cancel</button><button class="danger-button" data-confirm-delete>Delete ${label}</button></div>
    </div>`);
  document.querySelector('.modal-close-action').onclick = closeModal;
  document.querySelector('[data-confirm-delete]').onclick = (event) => deleteItem(kind, slug, event.currentTarget);
}

async function deleteItem(kind, slug, button) {
  const item = kind === 'app' ? selectedApp : selectedPrompt;
  if (!item || item.slug !== slug) return;
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    await api(`/api/${kind}s/${encodeURIComponent(slug)}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: state.selected.id }) });
    if (kind === 'app') {
      selectedApp = null;
      appResults = [];
      appInputValues = {};
      view = 'apps';
    } else {
      selectedPrompt = null;
      view = 'prompts';
    }
    closeModal();
    await refresh();
    toast(`${item.name} was deleted.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = `Delete ${kind === 'app' ? 'App' : 'Prompt'}`;
    toast(error.message, true);
  }
}

function workspaceSwitcher() {
  modal(`<div class="modal-head"><h2>Workspaces</h2><div class="modal-head-actions">${iconButton('add', 'Add workspace', 'id="add-workspace"')}<button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div></div>
    <div class="workspace-list">${state.workspaces.map((workspace) => `<div class="workspace-row ${workspace.id === state.selected.id ? 'selected' : ''}">
      <div data-select="${workspace.id}" class="workspace-choice" role="button" tabindex="0"><span><b class="editable-workspace-name" contenteditable="plaintext-only" spellcheck="true" data-workspace-name="${workspace.id}" title="Click to rename">${escapeHtml(workspace.name)}</b><small>${escapeHtml(workspace.path)}</small></span></div>
      <div class="workspace-actions">${iconButton('remove', 'Remove workspace', `data-remove="${workspace.id}"`)}</div>
    </div>`).join('')}</div>`);
  document.querySelectorAll('[data-select]').forEach((choice) => {
    choice.onclick = async () => {
      await api(`/api/workspaces/${choice.dataset.select}/select`, { method:'POST' });
      closeModal();
      await refresh();
    };
    choice.addEventListener('keydown', (event) => {
      if (event.target.closest('[contenteditable]') || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      choice.click();
    });
  });
  document.querySelectorAll('[data-workspace-name]').forEach((element) => {
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('click', (event) => event.stopPropagation());
    element.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); element.blur(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        const workspace = state.workspaces.find((item) => item.id === element.dataset.workspaceName);
        element.textContent = workspace?.name || '';
        element.blur();
      }
    });
    element.addEventListener('blur', saveWorkspaceName);
  });
  document.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => removeWorkspace(button.dataset.remove));
  document.querySelector('#add-workspace').onclick = () => workspaceModal();
}

function workspaceModal(values = {}) {
  modal(`<div class="modal-head"><h2>Add workspace</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
    <form id="workspace-form">
      <label>Name<input name="name" required value="${escapeHtml(values.name || '')}" placeholder="My workspace"></label>
      <label>Folder<div class="path-input"><input name="folderPath" required readonly value="${escapeHtml(values.folderPath || '')}" placeholder="Select a folder"><button type="button" class="secondary" id="browse">Select folder</button></div></label>
      <button class="primary full" type="submit">Add workspace</button>
    </form>`);
  document.querySelector('#browse').onclick = () => directoryBrowser({
    name: document.querySelector('[name="name"]').value,
    folderPath: document.querySelector('[name="folderPath"]').value,
  });
  document.querySelector('#workspace-form').onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/workspaces', { method:'POST', body: JSON.stringify({ name:data.get('name'), folderPath:data.get('folderPath'), create:false }) });
      closeModal();
      await refresh();
    } catch (error) { toast(error.message, true); }
  };
}

async function directoryBrowser(values, folderPath) {
  try {
    const listing = await api(`/api/directories?path=${encodeURIComponent(folderPath || values.folderPath || '~')}`);
    modal(`<div class="modal-head"><h2>Choose folder</h2><button class="modal-close" aria-label="Close" data-tooltip="Close">×</button></div>
      <div class="folder-browser">
        <div class="folder-location"><span>Current folder</span><p>${escapeHtml(listing.path)}</p></div>
        <div class="folder-list">
          <button class="directory parent-directory" data-dir="${escapeHtml(listing.parent)}"><span>↑</span> Parent</button>
          <div class="directory-list">${listing.directories.map((directory) => `<button class="directory" data-dir="${escapeHtml(directory.path)}">${escapeHtml(directory.name)}<i>›</i></button>`).join('')}</div>
        </div>
        <div class="folder-actions"><button class="primary full" id="choose-directory">Choose this folder</button></div>
      </div>`);
    document.querySelectorAll('[data-dir]').forEach((button) => button.onclick = () => directoryBrowser(values, button.dataset.dir));
    document.querySelector('#choose-directory').onclick = () => workspaceModal({ name: values.name || listing.path.split('/').pop(), folderPath: listing.path });
  } catch (error) { toast(error.message, true); }
}

async function saveWorkspaceName(event) {
  const element = event.currentTarget;
  const workspace = state.workspaces.find((item) => item.id === element.dataset.workspaceName);
  const name = element.textContent.trim();
  if (!workspace || name === workspace.name) return;
  try {
    const updated = await api(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { method:'PATCH', body:JSON.stringify({ name }) });
    Object.assign(workspace, updated);
    if (state.selected?.id === workspace.id) {
      Object.assign(state.selected, updated);
      const visibleName = document.querySelector('#workspace-switch b');
      if (visibleName) visibleName.textContent = updated.name;
    }
    element.textContent = updated.name;
    toast('Workspace name saved.');
  } catch (error) {
    element.textContent = workspace.name;
    toast(error.message, true);
  }
}

async function removeWorkspace(id) {
  const workspace = state.workspaces.find((item) => item.id === id);
  if (!workspace) return;
  try {
    await api(`/api/workspaces/${encodeURIComponent(id)}`, { method:'DELETE' });
    closeModal();
    await refresh();
    toast(`${workspace.name} was removed. Its folder was not deleted.`);
    if (state.selected) workspaceSwitcher();
  } catch (error) { toast(error.message, true); }
}

function modal(content, { className = '', backdropClass = '', clickAway = false } = {}) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop ${backdropClass}">${clickAway ? '<button class="modal-clickaway" aria-label="Dismiss information"></button>' : ''}<section class="modal ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
  document.querySelector('.modal-close')?.addEventListener('click', closeModal);
  document.querySelector('.modal-clickaway')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setTimeout(closeModal, 0);
  });
  if (modalEscapeHandler) document.removeEventListener('keydown', modalEscapeHandler);
  modalEscapeHandler = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', modalEscapeHandler);
}
function closeModal() {
  document.querySelector('#modal-root').innerHTML = '';
  if (modalEscapeHandler) document.removeEventListener('keydown', modalEscapeHandler);
  modalEscapeHandler = null;
}
function toast(message, error = false) {
  const root = document.querySelector('#toast-root');
  root.innerHTML = `<div class="toast ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  setTimeout(() => { if (root) root.innerHTML = ''; }, 3200);
}

document.addEventListener('pointerdown', dismissFileTransientState);
document.addEventListener('pointerover', (event) => {
  const target = event.target.closest?.('[data-tooltip]');
  if (!target || target === tooltipTarget) return;
  hideQuickTooltip();
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => showQuickTooltip(target), 500);
});
document.addEventListener('pointerout', (event) => {
  const target = event.target.closest?.('[data-tooltip]');
  if (target && !target.contains(event.relatedTarget)) hideQuickTooltip();
});
document.addEventListener('focusin', (event) => {
  const target = event.target.closest?.('[data-tooltip]');
  if (!target) return;
  hideQuickTooltip();
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => showQuickTooltip(target), 80);
});
document.addEventListener('focusout', (event) => {
  if (event.target.closest?.('[data-tooltip]')) hideQuickTooltip();
});
document.addEventListener('scroll', hideQuickTooltip, true);
window.addEventListener('resize', hideQuickTooltip);

refresh().catch((error) => {
  app.innerHTML = `<main class="welcome"><section><h1>Runlet could not start</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});
