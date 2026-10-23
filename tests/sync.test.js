'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');const sync=require('../sync-core');
function pair(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spt-sync-'));
 const a=new DatabaseSync(path.join(dir,'a.db'));const b=new DatabaseSync(path.join(dir,'b.db'));
 for(const d of [a,b]){d.exec('PRAGMA foreign_keys=ON');d.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,sort_order INTEGER DEFAULT 0);CREATE TABLE cabinets(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL);CREATE TABLE module_types(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);CREATE TABLE parts(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT);CREATE TABLE module_nos(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT);CREATE TABLE module_models(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,module_type_id INTEGER REFERENCES module_types(id));CREATE TABLE signal_types(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,part_id INTEGER REFERENCES parts(id));CREATE TABLE modules(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,cabinet_id INTEGER REFERENCES cabinets(id),module_type_id INTEGER REFERENCES module_types(id),module_model_id INTEGER REFERENCES module_models(id),module_no TEXT,created_by INTEGER,UNIQUE(project_id,cabinet_id,module_no));CREATE TABLE points(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,signal_type_id INTEGER REFERENCES signal_types(id),point_name TEXT);CREATE TABLE project_cabinet_order(project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,cabinet_id INTEGER REFERENCES cabinets(id),sort_order INTEGER,PRIMARY KEY(project_id,cabinet_id));`);sync.install(d);}
 t.after(()=>{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});});return {a,b};
}
function round(a,b){sync.merge(a,sync.snapshot(b));sync.merge(b,sync.snapshot(a),{preferIncoming:true});}
test('first download, offline persistence, both directions, same row count additions and ID collision',t=>{
 const {a,b}=pair(t);a.exec("INSERT INTO projects(name) VALUES('VPS');");round(a,b);assert.equal(b.prepare('SELECT COUNT(*) n FROM projects').get().n,1);
 a.exec("INSERT INTO projects(name) VALUES('server-new')");b.exec("INSERT INTO projects(name) VALUES('phone-new')");assert.equal(a.prepare("SELECT id FROM projects WHERE name='server-new'").get().id,b.prepare("SELECT id FROM projects WHERE name='phone-new'").get().id);round(a,b);
 assert.deepEqual(a.prepare('SELECT name FROM projects ORDER BY name').all(),b.prepare('SELECT name FROM projects ORDER BY name').all());assert.equal(sync.snapshot(a).length,3);
 const old=sync.snapshot(a);round(a,b);assert.deepEqual(sync.snapshot(a),old);
});
test('newest record wins in either direction, equal time server wins deterministically',t=>{
 const {a,b}=pair(t);a.exec("INSERT INTO projects(name) VALUES('base')");round(a,b);
 a.exec("UPDATE projects SET name='server-newest'");b.exec("UPDATE projects SET name='phone-old'");a.exec('UPDATE mobile_sync_records SET updated_at=updated_at+1000');round(a,b);assert.equal(b.prepare('SELECT name FROM projects').get().name,'server-newest');
 b.exec("UPDATE projects SET name='phone-newest'");b.exec('UPDATE mobile_sync_records SET updated_at=updated_at+2000');round(a,b);assert.equal(a.prepare('SELECT name FROM projects').get().name,'phone-newest');
 a.exec("UPDATE projects SET name='server-tie'");b.exec("UPDATE projects SET name='phone-tie'");const ts=Date.now()+10000;for(const d of[a,b])d.prepare('UPDATE mobile_sync_records SET updated_at=?').run(ts);round(a,b);assert.equal(b.prepare('SELECT name FROM projects').get().name,'server-tie');
});
test('deletion tombstones stop stale resurrection, parent cascades remove children',t=>{
 const {a,b}=pair(t);a.exec("INSERT INTO projects(name) VALUES('delete'); INSERT INTO points(project_id,point_name) VALUES(1,'G6');");round(a,b);const stale=sync.snapshot(b);a.exec('DELETE FROM projects');round(a,b);sync.merge(a,stale);assert.equal(a.prepare('SELECT COUNT(*) n FROM projects').get().n,0);assert.equal(b.prepare('SELECT COUNT(*) n FROM points').get().n,0);assert.ok(sync.snapshot(b).every(r=>r.deleted));
});
test('invalid payload and uniqueness conflict roll back atomically without losing local edits',t=>{
 const {a,b}=pair(t);a.exec("INSERT INTO projects(name) VALUES('same')");b.exec("INSERT INTO projects(name) VALUES('same');INSERT INTO projects(name) VALUES('unsent');");const before=sync.snapshot(a);assert.throws(()=>round(a,b));assert.deepEqual(sync.snapshot(a),before);assert.equal(b.prepare('SELECT COUNT(*) n FROM projects').get().n,2);
 assert.throws(()=>sync.merge(a,[{table:'users',uuid:'a'.repeat(32),updated_at:Date.now(),deleted:false,data:{}}]));assert.deepEqual(sync.snapshot(a),before);
});
