const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const target = process.argv[2];
fs.mkdirSync(path.dirname(target), { recursive: true });
const db = new DatabaseSync('/data/signal-points.db', { readOnly: true });
backup(db, target).then(() => {
  fs.chmodSync(target, 0o600);
  db.close();
  console.log(`Database backup: ${target}`);
}).catch(e => { db.close(); console.error(e); process.exitCode = 1; });
