'use client';

import { useState } from 'react';

const actions = [
  { id:'sales-report', name:'Sales Report', description:'Turns sales.csv into a polished weekly PDF report.', icon:'↗', tone:'coral', status:'Ready', lastRun:'Today, 8:13 AM', output:'report.pdf', readme:['Put your latest sales.csv in the Files area.','Click Run. Your original file stays untouched.','Open or download report.pdf when the run finishes.'] },
  { id:'sales-dashboard', name:'Sales Dashboard', description:'Refreshes an interactive view of sales by region and product.', icon:'◫', tone:'violet', status:'Ready', lastRun:'Yesterday, 4:42 PM', output:'dashboard-data.json', readme:['Upload a CSV containing date, product, region, and amount columns.','Click Run to refresh the dashboard data.','Click Open to explore the latest interactive dashboard.'], canOpen:true },
];

export default function Home() {
  const [selectedId, setSelectedId] = useState('sales-report');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0];
  function runAction(id:string) { setSelectedId(id); setRunningId(id); setNotice(''); window.setTimeout(() => { setRunningId(null); setNotice(`${actions.find((action) => action.id === id)?.name} finished successfully.`); }, 1250); }
  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><span>Workshop</span></div>
      <button className="workspace-switcher"><span className="workspace-avatar">S</span><span><b>Sales workspace</b><small>3 members</small></span><span className="chevron">⌄</span></button>
      <nav aria-label="Workspace navigation"><button><span>▤</span> Files <span className="count">6</span></button><button className="active"><span>◆</span> Actions <span className="count">2</span></button></nav>
      <div className="sidebar-bottom"><button onClick={() => setShowConnect(true)}><span>⌁</span> Connect AI</button><button onClick={() => setShowConnect(true)}><span>?</span> Help & setup</button><div className="profile"><span className="avatar">AV</span><span><b>Alex V.</b><small>alex@example.com</small></span></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><div><p className="eyebrow">SALES WORKSPACE</p><h1>Actions</h1></div><div className="top-actions"><button className="secondary">＋ Upload file</button><button className="primary" onClick={() => setShowConnect(true)}>＋ New with AI</button></div></header>
      {notice && <div className="notice" role="status"><span>✓</span>{notice}<button onClick={() => setNotice('')}>×</button></div>}
      <div className="content-grid">
        <div className="action-list">
          <div className="section-heading"><div><h2>Your actions</h2><p>Small tools made for this workspace.</p></div><button className="icon-button" aria-label="More options">•••</button></div>
          {actions.map((action) => <article key={action.id} className={`action-card ${selectedId === action.id ? 'selected' : ''}`} onClick={() => setSelectedId(action.id)}>
            <div className={`action-icon ${action.tone}`}>{action.icon}</div>
            <div className="action-copy"><div className="action-title"><h3>{action.name}</h3><span className="ready"><i />{runningId === action.id ? 'Running' : action.status}</span></div><p>{action.description}</p><div className="run-meta"><span>Last run</span><b>{runningId === action.id ? 'Just now' : action.lastRun}</b><span className="dot">·</span><span className="output-pill">▧ {action.output}</span></div></div>
            <div className="card-actions">{action.canOpen && <button className="secondary" onClick={(event) => { event.stopPropagation(); setNotice('Dashboard preview is ready to open.'); }}>Open</button>}<button className="run-button" disabled={runningId === action.id} onClick={(event) => { event.stopPropagation(); runAction(action.id); }}><span>{runningId === action.id ? '◌' : '▶'}</span>{runningId === action.id ? 'Running…' : 'Run'}</button><button className="more" aria-label={`More options for ${action.name}`}>•••</button></div>
          </article>)}
          <div className="ai-card"><div className="spark">✦</div><div><h3>Turn a request into an Action</h3><p>Ask Codex or Claude to build a reusable tool. It will appear here when it’s ready.</p></div><button onClick={() => setShowConnect(true)}>Connect AI <span>→</span></button></div>
        </div>
        <aside className="details">
          <div className="details-top"><div className={`action-icon ${selected.tone}`}>{selected.icon}</div><div><p className="eyebrow">HOW TO USE</p><h2>{selected.name}</h2></div><button className="close" aria-label="Close details">×</button></div>
          <p className="description">{selected.description}</p>
          <ol className="steps">{selected.readme.map((step,index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
          <div className="input-file"><span className="file-icon">▧</span><span><small>USES</small><b>sales.csv</b></span><span className="check">✓ Ready</span></div>
          <div className="details-actions"><button className="run-button large" onClick={() => runAction(selected.id)} disabled={runningId === selected.id}>{runningId === selected.id ? '◌  Running…' : '▶  Run action'}</button>{selected.canOpen && <button className="secondary large">Open</button>}</div>
          <details><summary>Advanced <span>⌄</span></summary><div className="advanced"><p>Source and run details are available here when you need them.</p><code>actions/{selected.id}/run.js</code></div></details>
        </aside>
      </div>
    </section>
    {showConnect && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowConnect(false)}><section className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close" onClick={() => setShowConnect(false)}>×</button><div className="spark modal-spark">✦</div><p className="eyebrow">CONNECT AI</p><h2 id="connect-title">Build Actions with Codex</h2><p className="modal-lead">Connect once, then ask Codex to turn files in this workspace into tools you can run anytime.</p><ol className="connect-steps"><li><span>1</span><div><b>Add Workshop to Codex</b><code>codex mcp add workshop --url https://your-workshop-host/mcp</code></div></li><li><span>2</span><div><b>Sign in</b><code>codex mcp login workshop</code></div></li><li><span>3</span><div><b>Ask for an outcome</b><p>“Use my sales.csv to create a weekly PDF report.”</p></div></li></ol><div className="tip"><b>Good to know</b><p>Codex will write a short README for every Action. Workshop shows that README as the Action’s How to use guide.</p></div><button className="run-button large" onClick={() => { navigator.clipboard?.writeText('codex mcp add workshop --url https://your-workshop-host/mcp'); setNotice('Setup command copied.'); setShowConnect(false); }}>Copy setup command</button></section></div>}
  </main>;
}
