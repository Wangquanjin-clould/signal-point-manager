/* Shared by Node and the Android WebView. No accounts or sessions are replicated. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MobileSync = factory();
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const tables = ['projects','cabinets','module_types','parts','module_nos','module_models','signal_types','modules','points','project_cabinet_order'];
  const refs = { module_models:{module_type_id:'module_types'}, signal_types:{part_id:'parts'}, modules:{project_id:'projects',cabinet_id:'cabinets',module_type_id:'module_types',module_model_id:'module_models'}, points:{project_id:'projects',module_id:'modules',signal_type_id:'signal_types'}, project_cabinet_order:{project_id:'projects',cabinet_id:'cabinets'} };
  const nowSql = "CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)+(SELECT clock_offset FROM mobile_sync_control WHERE id=1)";
  const q = s => '"'+s.replaceAll('"','""')+'"';
  function install(db) {
    db.exec('PRAGMA recursive_triggers=ON');
    db.exec(`CREATE TABLE IF NOT EXISTS mobile_sync_control (id INTEGER PRIMARY KEY, importing INTEGER NOT NULL,clock_offset INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO mobile_sync_control(id,importing) VALUES(1,0);
      CREATE TABLE IF NOT EXISTS mobile_sync_records(uuid TEXT PRIMARY KEY,table_name TEXT NOT NULL,row_id INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS mobile_sync_live ON mobile_sync_records(table_name,row_id) WHERE deleted=0;`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of tables) {
        db.exec(`INSERT INTO mobile_sync_records SELECT lower(hex(randomblob(16))),'${t}',x.rowid,${nowSql},0 FROM ${q(t)} x WHERE NOT EXISTS(SELECT 1 FROM mobile_sync_records r WHERE r.table_name='${t}' AND r.row_id=x.rowid AND r.deleted=0);
          CREATE TRIGGER IF NOT EXISTS mobile_${t}_insert AFTER INSERT ON ${q(t)} WHEN (SELECT importing FROM mobile_sync_control WHERE id=1)=0 BEGIN
            INSERT INTO mobile_sync_records VALUES(lower(hex(randomblob(16))),'${t}',NEW.rowid,${nowSql},0); END;
          CREATE TRIGGER IF NOT EXISTS mobile_${t}_update AFTER UPDATE ON ${q(t)} WHEN (SELECT importing FROM mobile_sync_control WHERE id=1)=0 BEGIN
            UPDATE mobile_sync_records SET updated_at=MAX(updated_at+1,${nowSql}) WHERE table_name='${t}' AND row_id=NEW.rowid AND deleted=0; END;
          CREATE TRIGGER IF NOT EXISTS mobile_${t}_delete AFTER DELETE ON ${q(t)} WHEN (SELECT importing FROM mobile_sync_control WHERE id=1)=0 BEGIN
            UPDATE mobile_sync_records SET updated_at=MAX(updated_at+1,${nowSql}),deleted=1 WHERE table_name='${t}' AND row_id=OLD.rowid AND deleted=0; END;`);
      }
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  function snapshot(db) {
    db.exec('BEGIN IMMEDIATE');
    try {
    const records = db.prepare('SELECT * FROM mobile_sync_records ORDER BY table_name,uuid').all().map(r => {
      const data = r.deleted ? {} : db.prepare(`SELECT * FROM ${q(r.table_name)} WHERE rowid=?`).get(r.row_id);
      if (!data) throw new Error('Missing live record '+r.uuid);
      const link = {};
      for(const [col,t] of Object.entries(refs[r.table_name] || {})) {
        if (data[col] != null) {
          const parent=db.prepare('SELECT uuid FROM mobile_sync_records WHERE table_name=? AND row_id=? AND deleted=0').get(t,data[col]);
          if (!parent) throw new Error('Missing parent '+t);
          link[col]=parent.uuid;
        } else link[col]=null;
        delete data[col];
      }
      delete data.id; delete data.created_by;
      return {uuid:r.uuid,table:r.table_name,updated_at:r.updated_at,deleted:!!r.deleted,data,refs:link};
    });
    db.exec('COMMIT');return records;
    } catch(e) {db.exec('ROLLBACK');throw e;}
  }
  function merge(db, records, options={}) {
    if(!Array.isArray(records) || records.length>100000) throw new Error('Invalid sync records');
    const seen=new Set();
    const chosen=[];
    for (const r of records) {
      if(!r || !tables.includes(r.table) || !/^[a-f0-9]{32}$/.test(r.uuid) || seen.has(r.uuid) || !Number.isSafeInteger(r.updated_at) || r.updated_at<0 || r.updated_at>(options.now||Date.now())+300000 || typeof r.deleted!=='boolean' || !r.data || typeof r.data!=='object' || Array.isArray(r.data)) throw new Error('Invalid record');
      seen.add(r.uuid);
      const old=db.prepare('SELECT * FROM mobile_sync_records WHERE uuid=?').get(r.uuid);
      if(old && old.table_name!==r.table) throw new Error('Identity table mismatch');
      if(!old || r.updated_at>old.updated_at || (options.preferIncoming && r.updated_at===old.updated_at)) chosen.push({r,old});
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('UPDATE mobile_sync_control SET importing=1 WHERE id=1');
      for (const {r,old} of chosen.filter(x=>x.r.deleted).sort((a,b)=>tables.indexOf(b.r.table)-tables.indexOf(a.r.table))) {
        if(old && !old.deleted) db.prepare(`DELETE FROM ${q(r.table)} WHERE rowid=?`).run(old.row_id);
        if(old)db.prepare('UPDATE mobile_sync_records SET updated_at=?,deleted=1 WHERE uuid=?').run(r.updated_at,r.uuid);
        else db.prepare('INSERT INTO mobile_sync_records(uuid,table_name,row_id,updated_at,deleted) VALUES(?,?,?,?,1)').run(r.uuid,r.table,-1,r.updated_at);
      }
      const deletedAt=Math.max(0,...chosen.filter(x=>x.r.deleted).map(x=>x.r.updated_at));
      // A parent deletion also tombstones descendants removed by SQLite cascades.
      if(deletedAt) for(const t of tables) db.prepare(`UPDATE mobile_sync_records SET deleted=1,updated_at=MAX(updated_at,?) WHERE table_name=? AND deleted=0 AND NOT EXISTS(SELECT 1 FROM ${q(t)} WHERE rowid=mobile_sync_records.row_id)`).run(deletedAt,t);
      for (const {r,old} of chosen.filter(x=>!x.r.deleted).sort((a,b)=>tables.indexOf(a.r.table)-tables.indexOf(b.r.table))) {
        const cols=db.prepare(`PRAGMA table_info(${q(r.table)})`).all().map(c=>c.name);
        const data={...r.data};
        for(const key of Object.keys(data)) if(!cols.includes(key) || ['id','created_by'].includes(key) || Object.hasOwn(refs[r.table]||{},key)) throw new Error('Invalid column '+key);
        for(const [col,t] of Object.entries(refs[r.table] || {})) {
          const uuid=r.refs?.[col];
          if(uuid==null) data[col]=null;
          else {
            const parent=db.prepare('SELECT row_id FROM mobile_sync_records WHERE uuid=? AND table_name=? AND deleted=0').get(uuid,t);
            if(!parent) throw new Error('Referenced record was deleted or is missing: '+t);
            data[col]=parent.row_id;
          }
        }
        const keys=Object.keys(data), values=keys.map(k=>data[k]);
        if(old && !old.deleted && db.prepare(`SELECT rowid FROM ${q(r.table)} WHERE rowid=?`).get(old.row_id)) {
          db.prepare(`UPDATE ${q(r.table)} SET ${keys.map(k=>q(k)+'=?').join(',')} WHERE rowid=?`).run(...values,old.row_id);
          db.prepare('UPDATE mobile_sync_records SET updated_at=? WHERE uuid=?').run(r.updated_at,r.uuid);
        } else {
          const result=db.prepare(`INSERT INTO ${q(r.table)} (${keys.map(q).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...values);
          if(old)db.prepare('UPDATE mobile_sync_records SET row_id=?,updated_at=?,deleted=0 WHERE uuid=?').run(Number(result.lastInsertRowid),r.updated_at,r.uuid);
          else db.prepare('INSERT INTO mobile_sync_records VALUES(?,?,?,?,0)').run(r.uuid,r.table,Number(result.lastInsertRowid),r.updated_at);
        }
      }
      if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key validation failed');
      if(options.validate) options.validate(db);
      db.exec('UPDATE mobile_sync_control SET importing=0 WHERE id=1; COMMIT');
      return chosen.length;
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  function validateBusiness(db) {
    if(db.prepare(`SELECT m.id FROM modules m JOIN module_models mm ON mm.id=m.module_model_id
      WHERE mm.module_type_id<>m.module_type_id OR trim(m.module_no)='' OR mm.channel_count<1 OR mm.channel_count>4096 LIMIT 1`).get()) throw new Error('模块型号、类型或通道数不一致');
    if(db.prepare(`SELECT p.id FROM points p JOIN modules m ON m.id=p.module_id WHERE p.project_id<>m.project_id LIMIT 1`).get()) throw new Error('点位与模块所属项目不一致');
    if(db.prepare(`SELECT m.id FROM modules m JOIN module_models mm ON mm.id=m.module_model_id JOIN points p ON p.module_id=m.id GROUP BY m.id HAVING COUNT(*)>mm.channel_count LIMIT 1`).get()) throw new Error('点位数量超过模块通道数');
  }
  return {tables,refs,install,snapshot,merge,validateBusiness};
});
