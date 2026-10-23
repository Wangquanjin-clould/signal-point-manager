const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = ['projects', 'cabinets', 'module_types', 'module_models', 'module_nos', 'parts', 'modules', 'points', 'signal_types', 'users'];
const digest = crypto.createHash('sha256');
const counts = {};
for (const table of tables) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  if (table === 'signal_types' && process.argv.includes('--exclude-program-name')) rows.forEach(row => { delete row.program_name; });
  counts[table] = rows.length;
  digest.update(JSON.stringify({ table, rows }));
}
const duplicateModules = db.prepare('SELECT project_id, cabinet_id, module_no, COUNT(*) AS count FROM modules GROUP BY project_id, cabinet_id, module_no HAVING COUNT(*) > 1').all();
console.log(JSON.stringify({ counts, sha256: digest.digest('hex'), integrity: db.prepare('PRAGMA quick_check').get(), duplicateModules }));
db.close();
