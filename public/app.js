const app = document.querySelector('#app');
const initialLocation = new URLSearchParams(window.location.search);
let state = { workspaces: [], scripts: [], prompts: [], files: [], selected: null, connections: [] };
let view = ['scripts', 'prompts', 'files', 'connections'].includes(initialLocation.get('view')) ? initialLocation.get('view') : 'scripts';
let selectedScript = null;
let selectedPrompt = null;
let scriptResults = [];
let scriptInputValues = {};
let filePath = initialLocation.get('path') || '.';
let selectedWorkspaceId = null;
let connectionsLoading = false;
let scriptSearch = '';
let promptSearch = '';
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
};
const iconButton = (icon, label, attributes = '') => `<button class="icon-button" aria-label="${escapeHtml(label)}" data-tooltip="${escapeHtml(label)}" ${attributes}>${icons[icon]}</button>`;
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
  } else {
    selectedWorkspaceId = state.selected?.id || null;
  }
  if (state.selected && filePath !== '.') {
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
  }
  if (selectedScript) selectedScript = state.scripts.find((script) => script.slug === selectedScript.slug) || null;
  if (selectedPrompt) selectedPrompt = state.prompts.find((prompt) => prompt.slug === selectedPrompt.slug) || null;
  render();
}

function render() {
  if (!state.selected) return renderWelcome();
  const collectionView = !selectedScript && !selectedPrompt && (view === 'scripts' || view === 'prompts');
  const content = selectedScript ? scriptDetail(selectedScript)
    : selectedPrompt ? promptDetail(selectedPrompt)
      : view === 'files' ? filesView() : view === 'prompts' ? promptsView() : view === 'connections' ? connectionsView() : scriptsView();
  app.innerHTML = `<main class="shell">
    <aside class="sidebar">
      <div class="brand"><span>R</span><b>Runlet</b></div>
      <button class="workspace-switch" id="workspace-switch">
        <span><b>${escapeHtml(state.selected.name)}</b><small>${escapeHtml(state.selected.path)}</small></span>
        <i>⌄</i>
      </button>
      <nav>
        <button data-view="scripts" class="${view === 'scripts' ? 'active' : ''}">Scripts <em>${state.scripts.length}</em></button>
        <button data-view="prompts" class="${view === 'prompts' ? 'active' : ''}">Prompts <em>${state.prompts.length}</em></button>
        <button data-view="files" class="${view === 'files' ? 'active' : ''}">Files <em>${state.files.length}</em></button>
        <button data-view="connections" class="${view === 'connections' ? 'active' : ''}">Connections</button>
      </nav>
    </aside>
    <section class="main ${collectionView ? 'collection-main' : ''} ${view === 'files' && !selectedScript && !selectedPrompt ? 'files-main' : ''}">${content}</section>
  </main><div id="modal-root"></div><div id="toast-root"></div>`;
  bindEvents();
}

function renderWelcome() {
  app.innerHTML = `<main class="welcome"><section>
    <h1>Runlet</h1>
    <p>Choose a folder. Keep its files, Scripts, and Prompts together.</p>
    <div class="welcome-actions">
      <button class="primary" id="add-workspace">Add workspace</button>
    </div>
    <small>Runlet only uses folders you add.</small>
  </section></main><div id="modal-root"></div><div id="toast-root"></div>`;
  document.querySelector('#add-workspace').onclick = () => workspaceModal();
}

function topbar(title, subtitle = '', controls = '', editableKind = '') {
  const backLabel = selectedScript ? 'Scripts' : selectedPrompt ? 'Prompts' : '';
  const editable = editableKind
    ? `class="editable-meta" contenteditable="plaintext-only" spellcheck="true" data-meta-kind="${editableKind}"`
    : '';
  return `<header class="topbar"><div>
    ${backLabel ? `<button class="back" id="back">← ${backLabel}</button>` : ''}
    <h1 ${editable} data-meta-field="name">${escapeHtml(title)}</h1>
    ${subtitle || editableKind ? `<p ${editable} data-meta-field="description">${escapeHtml(subtitle)}</p>` : ''}
  </div><div class="top-controls">${controls}</div></header>`;
}

function scriptsView() {
  const cards = state.scripts.length
    ? state.scripts.map((script) => `<article class="action-card" data-script="${escapeHtml(script.slug)}" data-order-item="${escapeHtml(script.slug)}" data-search-text="${escapeHtml(`${script.name} ${script.description}`.toLowerCase())}">
        <div class="action-copy">
          <h2>${escapeHtml(script.name)}</h2>
          <p>${escapeHtml(script.description)}</p>
        </div>
        <div class="card-actions">
          <button class="primary small open-script" data-open-script="${escapeHtml(script.slug)}">Open</button>
          ${dragHandle('script', script.slug)}
        </div>
      </article>`).join('')
    : `<div class="empty"><h2>No Scripts yet</h2><p>Try asking: “Ask Runlet to create a Script in ${escapeHtml(state.selected.name)}.”</p></div>`;
  const search = state.scripts.length ? listSearch('script', scriptSearch) : '';
  return `${topbar('Scripts', 'Small programs that run locally.', iconButton('refresh', 'Refresh', 'id="refresh"'))}<div class="page collection-page">${search}<div class="action-list" data-order-list="scripts">${cards}${noSearchResults('script')}</div></div>`;
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
  return `${topbar('Prompts', 'Saved instructions for your AI.', iconButton('refresh', 'Refresh', 'id="refresh"'))}<div class="page collection-page">${search}<div class="action-list" data-order-list="prompts">${cards}${noSearchResults('prompt')}</div></div>`;
}

function listSearch(kind, value) {
  const label = kind === 'script' ? 'Scripts' : 'Prompts';
  return `<label class="list-search" for="${kind}-search">${icons.search}<span class="visually-hidden">Search ${label}</span><input id="${kind}-search" type="search" value="${escapeHtml(value)}" placeholder="Search ${label}" autocomplete="off"></label>`;
}

function noSearchResults(kind) {
  return `<div class="empty compact search-empty" data-search-empty="${kind}" hidden><p>No matching ${kind === 'script' ? 'Scripts' : 'Prompts'}.</p></div>`;
}

function scriptDetail(script) {
  const controlFields = script.controls.length
    ? script.controls.map((control) => renderScriptControl(control)).join('')
    : '<p class="muted">This Script is ready to run.</p>';
  const resultPanels = scriptResults.filter((result) => !result.missing).map(renderResult).join('');
  const topControls = `${script.hasView ? `<a class="secondary" target="_blank" rel="noopener" href="/script-view/${state.selected.id}/${encodeURIComponent(script.slug)}">Previous run</a>` : ''}${iconButton('remove', 'Delete Script', `data-delete-kind="script" data-delete-slug="${escapeHtml(script.slug)}"`)}`;
  return `${topbar(script.name, script.description, topControls, 'script')}<div class="script-app">
    <form id="script-run-form" class="control-panel">
      <div class="control-grid">${controlFields}</div>
      <div class="run-footer"><span>Runs locally in this workspace.</span><button class="primary run-script" type="submit" data-run-script="${escapeHtml(script.slug)}">Run</button></div>
    </form>
    ${script.results.length ? `<section class="results-section"><h2>Results</h2><div class="results-grid">${resultPanels || '<div class="empty compact"><p>Run the Script to see results.</p></div>'}</div></section>` : ''}
  </div>`;
}

function renderScriptControl(control) {
  const value = scriptInputValues[control.name] ?? control.default ?? control.options?.[0] ?? '';
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
  return `${topbar(prompt.name, prompt.description, controls, 'prompt')}<div class="prompt-page">
    <form id="prompt-form" class="prompt-editor">
      <label for="prompt-content">Prompt</label>
      <textarea id="prompt-content" name="content" spellcheck="true">${escapeHtml(prompt.content)}</textarea>
      <div class="editor-actions"><span>Try asking: “Ask Runlet to use the ${escapeHtml(prompt.name)} Prompt.”</span><button class="primary" type="submit">Save</button></div>
    </form>
  </div>`;
}

function filesView() {
  const rows = sortFiles(state.files).map((file) => {
    const kind = fileKind(file);
    return `<div class="finder-row ${file.type === 'directory' ? 'directory-row' : ''} ${selectedFilePath === file.path ? 'selected' : ''}" role="row" tabindex="0" draggable="true" data-file-entry="${escapeHtml(file.path)}" data-file-type="${file.type}" data-search-text="${escapeHtml(file.name.toLowerCase())}">
      <span class="file-name-cell" role="gridcell">${fileIcon(file)}<span class="file-name">${escapeHtml(file.name)}</span></span>
      <time role="gridcell" datetime="${escapeHtml(file.modifiedAt)}">${escapeHtml(formatFileDate(file.modifiedAt))}</time>
      <small role="gridcell">${file.type === 'directory' ? '--' : formatSize(file.size)}</small>
      <span class="file-kind" role="gridcell">${escapeHtml(kind)}</span>
    </div>`;
  }).join('');
  const currentName = filePath === '.' ? state.selected.name : filePath.split('/').filter(Boolean).at(-1);
  const sortLabels = { none: 'None', name: 'Name', kind: 'Kind', modified: 'Date Modified', size: 'Size' };
  return `<header class="files-topbar">
    <div class="files-nav-group">
      ${iconButton('back', 'Back', `id="files-back" ${fileHistoryIndex === 0 ? 'disabled' : ''}`)}
      ${iconButton('forward', 'Forward', `id="files-forward" ${fileHistoryIndex >= fileHistory.length - 1 ? 'disabled' : ''}`)}
    </div>
    <div class="files-location"><h1>${escapeHtml(currentName)}</h1><nav class="breadcrumbs" aria-label="Current folder">${fileBreadcrumbs()}</nav></div>
    <div class="files-actions">
      <label class="file-search" for="file-search">${icons.search}<span class="visually-hidden">Search this folder</span><input id="file-search" type="search" value="${escapeHtml(fileSearch)}" placeholder="Search" autocomplete="off"></label>
      <details class="sort-menu"><summary class="icon-button" aria-label="Sort files" data-tooltip="Sort files">${icons.sort}</summary><div class="sort-popover" role="menu"><p>Sort by</p>${Object.entries(sortLabels).map(([value, label]) => `<button role="menuitemradio" aria-label="${label}" aria-checked="${fileSort === value}" data-file-sort="${value}"><span>${fileSort === value ? '✓' : ''}</span>${label}</button>`).join('')}</div></details>
      ${iconButton('newFolder', 'New Folder', 'id="new-folder"')}
      ${iconButton('refresh', 'Refresh', 'id="refresh"')}
    </div>
  </header>
  <div class="finder-page">
    <div class="finder-table" role="grid" aria-label="Files in ${escapeHtml(currentName)}">
      <div class="finder-header" role="row">
        ${fileHeaderButton('name', 'Name')}${fileHeaderButton('modified', 'Date Modified')}${fileHeaderButton('size', 'Size')}${fileHeaderButton('kind', 'Kind')}
      </div>
      <div class="finder-body">${rows || `<div class="file-empty"><p>This folder is empty.</p>${iconButton('newFolder', 'New Folder', 'data-empty-new-folder')}</div>`}<div class="file-empty search-file-empty" hidden><p>No files match your search.</p></div></div>
    </div>
    <footer class="finder-status"><span data-file-count>${state.files.length} ${state.files.length === 1 ? 'item' : 'items'}</span><span>Drag an item onto a folder to move it</span></footer>
  </div>`;
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
    : (state.connections || []).map((connection) => `<article class="connection-card">
        <div class="connection-copy">
          <div class="connection-heading"><h2>${escapeHtml(connection.name)}</h2><span class="connection-status ${connection.connected ? 'connected' : ''}">${escapeHtml(connection.status)}</span></div>
          <p>${escapeHtml(connection.note || (connection.available ? 'Connect Runlet to this AI.' : `Install ${connection.name} to connect it.`))}</p>
        </div>
        <button class="${connection.connected ? 'secondary' : 'primary'} connection-action" data-connection="${connection.id}" data-connected="${connection.connected}" data-action="${escapeHtml(connection.action || (connection.connected ? 'disconnect' : 'connect'))}" ${connection.available ? '' : 'disabled'}>${escapeHtml(connection.actionLabel || (connection.connected ? 'Disconnect' : 'Connect'))}</button>
      </article>`).join('');
  return `${topbar('Connections', 'Use Runlet from the AI apps installed on this computer.', iconButton('refresh', 'Refresh', 'id="refresh-connections"'))}<div class="page connection-list">${cards}</div>`;
}

function fileBreadcrumbs() {
  const parts = filePath === '.' ? [] : filePath.split('/').filter(Boolean);
  const crumbs = [`<button data-file-path=".">${escapeHtml(state.selected.name)}</button>`];
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
    selectedScript = null;
    selectedPrompt = null;
    render();
    if (view === 'connections') loadConnections();
  });
  document.querySelectorAll('[data-script]').forEach((card) => card.onclick = (event) => {
    if (event.target.closest('button,a')) return;
    selectedScript = state.scripts.find((script) => script.slug === card.dataset.script);
    scriptResults = [];
    scriptInputValues = {};
    render();
  });
  document.querySelectorAll('[data-open-script]').forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    selectedScript = state.scripts.find((script) => script.slug === button.dataset.openScript);
    scriptResults = [];
    scriptInputValues = {};
    render();
  });
  document.querySelectorAll('[data-prompt]').forEach((card) => card.onclick = (event) => {
    if (event.target.closest('button,a')) return;
    selectedPrompt = state.prompts.find((prompt) => prompt.slug === card.dataset.prompt);
    render();
  });
  document.querySelectorAll('[data-copy-prompt]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); copyPrompt(button.dataset.copyPrompt); });
  bindListControls('script');
  bindListControls('prompt');
  document.querySelectorAll('[data-delete-kind]').forEach((button) => button.onclick = () => confirmDeleteItem(button.dataset.deleteKind, button.dataset.deleteSlug));
  document.querySelectorAll('[data-file-path]').forEach((button) => button.onclick = () => openFolder(button.dataset.filePath));
  bindFileBrowser();
  document.querySelector('#back')?.addEventListener('click', () => { selectedScript = null; selectedPrompt = null; scriptResults = []; scriptInputValues = {}; render(); });
  document.querySelector('#refresh')?.addEventListener('click', refresh);
  document.querySelector('#workspace-switch')?.addEventListener('click', workspaceSwitcher);
  document.querySelector('#refresh-connections')?.addEventListener('click', loadConnections);
  document.querySelectorAll('[data-connection]').forEach((button) => button.onclick = () => changeConnection(button));
  document.querySelector('#prompt-form')?.addEventListener('submit', savePrompt);
  document.querySelector('#script-run-form')?.addEventListener('submit', runScript);
  document.querySelectorAll('[data-meta-field]').forEach((element) => {
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); element.blur(); }
    });
    element.addEventListener('blur', saveMetadata);
  });
}

function bindListControls(kind) {
  const plural = `${kind}s`;
  const input = document.querySelector(`#${kind}-search`);
  if (input) {
    input.addEventListener('input', () => {
      if (kind === 'script') scriptSearch = input.value;
      else promptSearch = input.value;
      applyListFilter(kind, input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      input.value = '';
      if (kind === 'script') scriptSearch = '';
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
  const list = document.querySelector(`[data-order-list="${kind}s"]`);
  list?.classList.toggle('searching', Boolean(normalized));
  let matches = 0;
  list?.querySelectorAll('[data-order-item]').forEach((card) => {
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
  const slugs = state[kind].map((item) => visible.has(item.slug) ? visibleOrder[visibleIndex++] : item.slug);
  try {
    state[kind] = await api(`/api/order/${kind}`, { method: 'PUT', body: JSON.stringify({ workspaceId: state.selected.id, slugs }) });
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

async function openFolder(path) {
  try {
    const nextPath = path || '.';
    const files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(nextPath)}`);
    if (nextPath !== filePath) {
      fileHistory = fileHistory.slice(0, fileHistoryIndex + 1);
      fileHistory.push(nextPath);
      fileHistoryIndex = fileHistory.length - 1;
    }
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
  const clearFileDragState = () => {
    breadcrumbs?.classList.remove('drag-active');
    document.querySelectorAll('.drop-target, .drop-available').forEach((item) => item.classList.remove('drop-target', 'drop-available'));
  };
  breadcrumbTargets.forEach((button) => {
    button.addEventListener('dragover', (event) => {
      if (!draggedPath || !canMoveFileToFolder(draggedPath, button.dataset.filePath)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      breadcrumbTargets.forEach((item) => item.classList.toggle('drop-target', item === button));
    });
    button.addEventListener('dragleave', (event) => {
      if (!button.contains(event.relatedTarget)) button.classList.remove('drop-target');
    });
    button.addEventListener('drop', (event) => {
      if (!draggedPath || !canMoveFileToFolder(draggedPath, button.dataset.filePath)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = draggedPath;
      const destination = button.dataset.filePath;
      draggedPath = null;
      clearFileDragState();
      void moveFileToFolder(source, destination);
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
      row.classList.add('dragging');
      breadcrumbs?.classList.add('drag-active');
      breadcrumbTargets.forEach((button) => button.classList.toggle('drop-available', canMoveFileToFolder(draggedPath, button.dataset.filePath)));
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPath);
    });
    row.addEventListener('dragend', () => {
      draggedPath = null;
      row.classList.remove('dragging');
      clearFileDragState();
    });
    if (row.dataset.fileType !== 'directory') return;
    row.addEventListener('dragover', (event) => {
      if (!draggedPath || draggedPath === row.dataset.fileEntry) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drop-target');
      if (draggedPath) void moveFileToFolder(draggedPath, row.dataset.fileEntry);
    });
  });
}

function dismissFileTransientState(event) {
  const sortMenu = document.querySelector('.sort-menu[open]');
  if (sortMenu && !sortMenu.contains(event.target)) sortMenu.removeAttribute('open');
  if (!selectedFilePath || event.target.closest('[data-file-entry]')) return;
  selectedFilePath = null;
  document.querySelectorAll('[data-file-entry].selected').forEach((row) => row.classList.remove('selected'));
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

async function moveFileToFolder(from, folder) {
  const name = from.split('/').at(-1);
  const to = folder === '.' ? name : `${folder}/${name}`;
  if (!canMoveFileToFolder(from, folder)) {
    toast('A folder cannot be moved into itself.', true);
    return;
  }
  try {
    await api('/api/files/move', { method: 'PATCH', body: JSON.stringify({ workspaceId: state.selected.id, from, to }) });
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
    render();
    toast(`${name} moved.`);
  } catch (error) { toast(error.message, true); }
}

function canMoveFileToFolder(from, folder) {
  const name = from.split('/').at(-1);
  const to = folder === '.' ? name : `${folder}/${name}`;
  return from !== to && !folder.startsWith(`${from}/`);
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

async function loadScriptResults() {
  if (!selectedScript || !selectedScript.results.length) return;
  const slug = selectedScript.slug;
  try {
    scriptResults = await api(`/api/scripts/${encodeURIComponent(slug)}/results?workspaceId=${encodeURIComponent(state.selected.id)}`);
    if (selectedScript?.slug === slug) render();
  } catch (error) { toast(error.message, true); }
}

async function runScript(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[data-run-script]');
  const slug = button.dataset.runScript;
  const hasView = selectedScript?.slug === slug && selectedScript.hasView;
  const viewWindow = hasView ? window.open('about:blank', '_blank') : null;
  if (viewWindow) {
    viewWindow.opener = null;
    viewWindow.document.title = `${selectedScript.name} — Running`;
    viewWindow.document.body.innerHTML = '<p style="font: 15px system-ui; padding: 24px; color: #555">Running Script…</p>';
  }
  scriptInputValues = Object.fromEntries(new FormData(form));
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const response = await api(`/api/scripts/${encodeURIComponent(slug)}/run`, { method:'POST', body: JSON.stringify({ workspaceId: state.selected.id, input: scriptInputValues }) });
    await refresh();
    if (hasView) {
      if (viewWindow) viewWindow.location.replace(`/script-view/${state.selected.id}/${encodeURIComponent(slug)}`);
      toast(viewWindow ? (response.logs?.at(-1) || 'Script finished. Its page opened in a new tab.') : 'Script finished. Use Previous run to view it.');
    } else {
      await loadScriptResults();
      toast(response.logs?.at(-1) || 'Script finished.');
    }
  } catch (error) {
    if (viewWindow) viewWindow.close();
    toast(error.message, true);
    button.disabled = false;
    button.textContent = old;
  }
}

async function saveMetadata(event) {
  const element = event.currentTarget;
  const kind = element.dataset.metaKind;
  const field = element.dataset.metaField;
  const item = kind === 'script' ? selectedScript : selectedPrompt;
  const value = element.textContent.trim();
  if (!item || value === item[field]) return;
  try {
    const updated = await api(`/api/${kind}s/${encodeURIComponent(item.slug)}`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceId: state.selected.id, [field]: value }),
    });
    if (kind === 'script') selectedScript = updated;
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

function confirmDeleteItem(kind, slug) {
  const item = kind === 'script' ? selectedScript : selectedPrompt;
  if (!item || item.slug !== slug) return;
  const label = kind === 'script' ? 'Script' : 'Prompt';
  const detail = kind === 'script'
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
  const item = kind === 'script' ? selectedScript : selectedPrompt;
  if (!item || item.slug !== slug) return;
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    await api(`/api/${kind}s/${encodeURIComponent(slug)}`, { method: 'DELETE', body: JSON.stringify({ workspaceId: state.selected.id }) });
    if (kind === 'script') {
      selectedScript = null;
      scriptResults = [];
      scriptInputValues = {};
      view = 'scripts';
    } else {
      selectedPrompt = null;
      view = 'prompts';
    }
    closeModal();
    await refresh();
    toast(`${item.name} was deleted.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = `Delete ${kind === 'script' ? 'Script' : 'Prompt'}`;
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

function modal(content) {
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
  document.querySelector('.modal-close')?.addEventListener('click', closeModal);
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
