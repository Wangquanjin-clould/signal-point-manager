const { DatabaseSync } = require('node:sqlite');
const before = new DatabaseSync('/data/backups/before-20261014-4.db', { readOnly: true });
const after = new DatabaseSync('/data/signal-points.db', { readOnly: true });
const changes = [];
for (const { name } of before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('sessions','sqlite_sequence')").all()) {
  const oldRows = before.prepare(`SELECT * FROM ${name}`).all();
  const newRows = after.prepare(`SELECT * FROM ${name}`).all();
  const key = r => r.id ?? `${r.project_id}:${r.cabinet_id}`;
  const current = new Map(newRows.map(r => [key(r), r]));
  for (const row of oldRows) {
    const updated = current.get(key(row));
    if (!updated) { changes.push({ table: name, id: key(row), deleted: true }); continue; }
    const fields = Object.keys(row).filter(field => field !== 'program_name' && row[field] !== updated[field]);
    if (fields.length) changes.push({ table: name, id: key(row), fields });
  }
  if (oldRows.length !== newRows.length) changes.push({ table: name, before: oldRows.length, after: newRows.length });
}
console.log(JSON.stringify(changes));
before.close(); after.close();
