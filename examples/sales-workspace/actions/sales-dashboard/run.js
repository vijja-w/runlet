export default async function ({ workspace, run }) {
  run.log('Refreshing dashboard data');
  const csv = await workspace.read('files/sales.csv');
  await workspace.mkdir('actions/sales-dashboard/outputs');
  await workspace.write('actions/sales-dashboard/outputs/data.json', JSON.stringify({ source: 'sales.csv', csv: String(csv) }));
}

