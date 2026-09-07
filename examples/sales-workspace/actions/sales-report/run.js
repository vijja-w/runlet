export default async function ({ workspace, run }) {
  run.log('Reading sales.csv');
  const csv = await workspace.read('files/sales.csv');
  const rows = String(csv).trim().split('\n').slice(1);
  const total = rows.reduce((sum, row) => sum + Number(row.split(',')[3] || 0), 0);
  await workspace.mkdir('actions/sales-report/outputs');
  await workspace.write('actions/sales-report/outputs/summary.json', JSON.stringify({ rows: rows.length, total }, null, 2));
  await workspace.write('actions/sales-report/outputs/report.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly Sales Report</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:16px system-ui;color:#292521}h1{font:42px Georgia}section{display:flex;gap:20px}.card{flex:1;padding:24px;border:1px solid #ddd5ca;border-radius:14px}.value{font-size:30px;font-weight:700;color:#d95f43}</style></head><body><p>WEEKLY REPORT</p><h1>Sales at a glance</h1><section><div class="card"><p>Total sales</p><div class="value">$${total.toLocaleString()}</div></div><div class="card"><p>Transactions</p><div class="value">${rows.length}</div></div></section></body></html>`);
  run.log(`Summarized ${rows.length} sales rows`);
}
