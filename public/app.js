const app = document.querySelector('#app');
let state = { workspaces: [], scripts: [], prompts: [], files: [], selected: null, connections: [] };
let view = 'scripts';
let selectedScript = null;
let selectedPrompt = null;
let scriptResults = [];
let scriptInputValues = {};
let filePath = '.';
let selectedWorkspaceId = null;
let connectionsLoading = false;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const icons = {
  add: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  refresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7A6 6 0 1 0 16 11"/><path d="M15.5 3v4h-4"/></svg>',
  remove: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.5h11M8 3.5h4l1 3H7l1-3ZM6.5 6.5l.6 10h5.8l.6-10M8.5 9v5M11.5 9v5"/></svg>',
};
const iconButton = (icon, label, attributes = '') => `<button class="icon-button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${attributes}>${icons[icon]}</button>`;
const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
};

async function refresh() {
  const connections = state.connections || [];
  state = { ...await api('/api/state'), connections };
  if (selectedWorkspaceId !== state.selected?.id) {
    selectedWorkspaceId = state.selected?.id || null;
    filePath = '.';
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
    <section class="main">${content}</section>
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
    ? state.scripts.map((script) => `<article class="action-card" data-script="${escapeHtml(script.slug)}">
        <div class="action-copy">
          <h2>${escapeHtml(script.name)}</h2>
          <p>${escapeHtml(script.description)}</p>
        </div>
        <div class="card-actions">
          ${script.hasView
            ? `<a class="primary small" href="/script-view/${state.selected.id}/${encodeURIComponent(script.slug)}" target="_blank" rel="noopener">Open</a>`
            : `<button class="primary small open-script" data-open-script="${escapeHtml(script.slug)}">Open</button>`}
        </div>
      </article>`).join('')
    : `<div class="empty"><h2>No Scripts yet</h2><p>Ask your AI: “@Runlet create a Script in ${escapeHtml(state.selected.name)}.”</p></div>`;
  return `${topbar('Scripts', 'Small programs that run locally.', iconButton('refresh', 'Refresh', 'id="refresh"'))}<div class="page">${cards}</div>`;
}

function promptsView() {
  const cards = state.prompts.length
    ? state.prompts.map((prompt) => `<article class="action-card" data-prompt="${escapeHtml(prompt.slug)}">
        <div class="action-copy"><h2>${escapeHtml(prompt.name)}</h2><p>${escapeHtml(prompt.description)}</p></div>
        <button class="secondary small copy-prompt" data-copy-prompt="${escapeHtml(prompt.slug)}">Copy</button>
      </article>`).join('')
    : `<div class="empty"><h2>No Prompts yet</h2><p>Ask your AI: “@Runlet create a Prompt in ${escapeHtml(state.selected.name)}.”</p></div>`;
  return `${topbar('Prompts', 'Saved instructions for your AI.', iconButton('refresh', 'Refresh', 'id="refresh"'))}<div class="page">${cards}</div>`;
}

function scriptDetail(script) {
  const controlFields = script.controls.length
    ? script.controls.map((control) => renderScriptControl(control)).join('')
    : '<p class="muted">This Script is ready to run.</p>';
  const resultPanels = scriptResults.filter((result) => !result.missing).map(renderResult).join('');
  const topControls = `${script.hasView ? `<a class="secondary" target="_blank" rel="noopener" href="/script-view/${state.selected.id}/${encodeURIComponent(script.slug)}">Open</a>` : ''}${iconButton('remove', 'Delete Script', `data-delete-kind="script" data-delete-slug="${escapeHtml(script.slug)}"`)}`;
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
      <div class="editor-actions"><span>Use in Codex: @Runlet use the “${escapeHtml(prompt.name)}” Prompt.</span><button class="primary" type="submit">Save</button></div>
    </form>
  </div>`;
}

function filesView() {
  const rows = state.files.map((file) => file.type === 'directory'
    ? `<button class="file-row directory-row" data-folder="${escapeHtml(file.path)}"><span>Folder</span><b>${escapeHtml(file.name)}</b><small></small><time>›</time></button>`
    : `<button class="file-row" data-open-file="${escapeHtml(file.path)}"><span>File</span><b>${escapeHtml(file.name)}</b><small>${formatSize(file.size)}</small><time>${new Date(file.modifiedAt).toLocaleDateString()}</time></button>`).join('');
  return `${topbar('Files', state.selected.path, iconButton('refresh', 'Refresh', 'id="refresh"'))}<div class="page">
    <nav class="breadcrumbs" aria-label="Current folder">${fileBreadcrumbs()}</nav>
    <div class="file-list">${rows || '<div class="empty compact"><p>This folder is empty.</p></div>'}</div>
  </div>`;
}

function connectionsView() {
  const cards = connectionsLoading
    ? '<div class="empty compact"><p>Checking your local AI apps…</p></div>'
    : (state.connections || []).map((connection) => `<article class="connection-card">
        <div class="connection-copy">
          <div class="connection-heading"><h2>${escapeHtml(connection.name)}</h2><span class="connection-status ${connection.connected ? 'connected' : ''}">${escapeHtml(connection.status)}</span></div>
          <p>${escapeHtml(connection.note || (connection.available ? 'Connect Runlet to this AI.' : `Install ${connection.name} to connect it.`))}</p>
          <div class="invocation"><span>Use it with</span><code>${escapeHtml(connection.invocation)}</code></div>
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
  document.querySelectorAll('[data-delete-kind]').forEach((button) => button.onclick = () => confirmDeleteItem(button.dataset.deleteKind, button.dataset.deleteSlug));
  document.querySelectorAll('[data-open-file]').forEach((button) => button.onclick = () => openFile(button.dataset.openFile));
  document.querySelectorAll('[data-folder]').forEach((button) => button.onclick = () => openFolder(button.dataset.folder));
  document.querySelectorAll('[data-file-path]').forEach((button) => button.onclick = () => openFolder(button.dataset.filePath));
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
    filePath = path || '.';
    state.files = await api(`/api/files?workspaceId=${encodeURIComponent(state.selected.id)}&path=${encodeURIComponent(filePath)}`);
    render();
  } catch (error) { toast(error.message, true); }
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
  scriptInputValues = Object.fromEntries(new FormData(form));
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const response = await api(`/api/scripts/${encodeURIComponent(slug)}/run`, { method:'POST', body: JSON.stringify({ workspaceId: state.selected.id, input: scriptInputValues }) });
    if (selectedScript?.slug === slug && selectedScript.hasView) {
      window.location.assign(`/script-view/${state.selected.id}/${encodeURIComponent(slug)}`);
      return;
    }
    await refresh();
    await loadScriptResults();
    toast(response.logs?.at(-1) || 'Script finished.');
  } catch (error) {
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
  modal(`<div class="modal-head"><h2>Delete ${label}?</h2><button class="modal-close" aria-label="Close" title="Close">×</button></div>
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
  modal(`<div class="modal-head"><h2>Workspaces</h2><div class="modal-head-actions">${iconButton('add', 'Add workspace', 'id="add-workspace"')}<button class="modal-close" aria-label="Close" title="Close">×</button></div></div>
    <div class="workspace-list">${state.workspaces.map((workspace) => `<div class="workspace-row ${workspace.id === state.selected.id ? 'selected' : ''}">
      <button data-select="${workspace.id}" class="workspace-choice"><span><b class="editable-workspace-name" contenteditable="plaintext-only" spellcheck="true" data-workspace-name="${workspace.id}" title="Click to rename">${escapeHtml(workspace.name)}</b><small>${escapeHtml(workspace.path)}</small></span></button>
      <div class="workspace-actions">${iconButton('remove', 'Remove workspace', `data-remove="${workspace.id}"`)}</div>
    </div>`).join('')}</div>`);
  document.querySelectorAll('[data-select]').forEach((button) => button.onclick = async () => {
    await api(`/api/workspaces/${button.dataset.select}/select`, { method:'POST' });
    closeModal();
    await refresh();
  });
  document.querySelectorAll('[data-workspace-name]').forEach((element) => {
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
  modal(`<div class="modal-head"><h2>Add workspace</h2><button class="modal-close" aria-label="Close" title="Close">×</button></div>
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
    modal(`<div class="modal-head"><h2>Choose folder</h2><button class="modal-close" aria-label="Close" title="Close">×</button></div>
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
}
function closeModal() { document.querySelector('#modal-root').innerHTML = ''; }
function toast(message, error = false) {
  const root = document.querySelector('#toast-root');
  root.innerHTML = `<div class="toast ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  setTimeout(() => { if (root) root.innerHTML = ''; }, 3200);
}

refresh().catch((error) => {
  app.innerHTML = `<main class="welcome"><section><h1>Runlet could not start</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});
