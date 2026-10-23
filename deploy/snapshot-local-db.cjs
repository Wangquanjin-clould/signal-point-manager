'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
(async () => {
  const source = new DatabaseSync(path.resolve('data/signal-points.db'), { readOnly: true });
  fs.mkdirSync('database', { recursive: true });
  await backup(source, 'database/local-snapshot.db');
  source.close();
  const db = new DatabaseSync('database/local-snapshot.db');
  db.exec('PRAGMA secure_delete=ON; DELETE FROM sessions; DELETE FROM users; UPDATE modules SET created_by=NULL; VACUUM;');
  console.log('integrity:', db.prepare('PRAGMA integrity_check').get());
  console.log('accounts:', db.prepare('SELECT COUNT(*) AS count FROM users').get());
  console.log('sessions:', db.prepare('SELECT COUNT(*) AS count FROM sessions').get());
  console.log('foreign keys:', db.prepare('PRAGMA foreign_key_check').all());
  db.close();
})().catch(e => { console.error(e); process.exitCode=1; });
