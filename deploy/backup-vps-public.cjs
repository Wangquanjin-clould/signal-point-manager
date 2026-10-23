'use strict';
// Run inside the production container. Source database is opened read-only.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
(async () => {
  const target = process.argv[2];
  if (!target) throw new Error('Usage: node backup-vps-public.cjs /tmp/snapshot.db');
  const source = new DatabaseSync('/data/signal-points.db', { readOnly: true });
  await backup(source, target);
  source.close();
  const db = new DatabaseSync(target);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('users','sessions') ORDER BY name").all().map(r => r.name);
  const businessDigest = () => {
    const hash = crypto.createHash('sha256');
    for (const table of tables) {
      const rows = db.prepare('SELECT * FROM "' + table.replaceAll('"','""') + '" ORDER BY rowid').all();
      if (table === 'modules') rows.forEach(r => { delete r.created_by; });
      hash.update(JSON.stringify({ table, rows }));
    }
    return hash.digest('hex');
  };
  const before = businessDigest();
  db.exec('PRAGMA secure_delete=ON; BEGIN; DELETE FROM sessions; DELETE FROM users; UPDATE modules SET created_by=NULL; COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
  const after = businessDigest();
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const counts = Object.fromEntries([...tables, 'users', 'sessions'].map(t => [t, db.prepare('SELECT COUNT(*) n FROM "' + t.replaceAll('"','""') + '"').get().n]));
  if (before !== after || integrity !== 'ok' || foreignKeys.length || counts.users || counts.sessions) throw new Error('Snapshot verification failed');
  db.close();
  console.log(JSON.stringify({ created_at: new Date().toISOString(), source: 'VPS signal-point-manager /data/signal-points.db', sanitized: ['users','sessions','modules.created_by'], business_sha256: after, business_unchanged: true, integrity, foreign_key_errors: foreignKeys.length, counts, file_sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') }));
})().catch(e => { console.error(e); process.exitCode=1; });
