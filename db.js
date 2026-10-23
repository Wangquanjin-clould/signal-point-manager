'use strict';
/**
 * 数据库层 —— 使用 Node.js 内置 node:sqlite（零第三方依赖）
 * 包含：建表、索引、初始数据种子（信号类型 31 条来自原 Excel）
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'signal-points.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',   -- admin | user
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 信号类型配置（管理员可维护；主表下拉与编号缩写均由此驱动）
CREATE TABLE IF NOT EXISTS signal_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,          -- 中文显示名
  abbr        TEXT    NOT NULL DEFAULT '',      -- 编号简写
  sensor_type TEXT    NOT NULL DEFAULT '',      -- 传感器类型
  no_sensor   INTEGER NOT NULL DEFAULT 0,       -- 1 = 该通道无传感器 → 编号写 Reserved
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- 基础选项：全部由管理员在「基础配置」中维护
CREATE TABLE IF NOT EXISTS projects    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cabinets    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS module_types(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, plc_prefix TEXT NOT NULL DEFAULT 'I', sort_order INTEGER NOT NULL DEFAULT 0);

-- 设备部位对照表：名称 → 编号参数（现场→B、电机→M），管理员可配置
CREATE TABLE IF NOT EXISTS parts(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,   -- 显示名，如「现场」
  param      TEXT    NOT NULL,          -- 编号参数，如「B」
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_param ON parts(param) WHERE active = 1;

-- 模块型号：绑定模块类型 + 总通道数（决定新增模块生成的行数）
CREATE TABLE IF NOT EXISTS module_models(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL UNIQUE,
  module_type_id INTEGER NOT NULL REFERENCES module_types(id) ON DELETE CASCADE,
  channel_count  INTEGER NOT NULL DEFAULT 8,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- 模块实例（由「新增模块」创建）
CREATE TABLE IF NOT EXISTS modules(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  cabinet_id      INTEGER NOT NULL REFERENCES cabinets(id),
  module_no       TEXT    NOT NULL,
  module_type_id  INTEGER NOT NULL REFERENCES module_types(id),
  module_model_id INTEGER NOT NULL REFERENCES module_models(id),
  note            TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  created_by      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_modules_project ON modules(project_id);

-- 点位行：module_id 可空（空 = 手工录入行，不属于任何模块）
CREATE TABLE IF NOT EXISTS points(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id      INTEGER          REFERENCES modules(id)  ON DELETE CASCADE,
  part           TEXT    NOT NULL DEFAULT '',   -- 设备部位
  point_name     TEXT    NOT NULL DEFAULT '',   -- 设备点位
  signal_type_id INTEGER          REFERENCES signal_types(id) ON DELETE SET NULL,
  plc_point      TEXT    NOT NULL DEFAULT '',   -- PLC点位
  sort_order     INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_project ON points(project_id);
CREATE INDEX IF NOT EXISTS idx_points_module  ON points(module_id);
`);

/* ------------------------------------------------------------------ */
/* 密码哈希（node:crypto scrypt，零依赖）                              */
/* ------------------------------------------------------------------ */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(password, salt, expected) {
  try {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 种子数据                                                            */
/* ------------------------------------------------------------------ */
// 来自原 Excel「信号类型配置」A/B/C 三列，顺序原样保留
const SEED_SIGNAL_TYPES = [
  ['上到位', 'Up', '接近开关'], ['下到位', 'Dn', '接近开关'],
  ['减速位', 'Dec', '漫反射光电'], ['停止位', 'S', '漫反射光电'],
  ['过载', 'Overload', '辅助触点'], ['故障', 'Fault', '辅助触点'],
  ['正转', 'Fwd', '按钮'], ['反转', 'Rev', '按钮'],
  ['上极限', 'HL', '限位开关'], ['上限位', 'H', '限位开关'],
  ['下极限', 'LL', '限位开关'], ['下限位', 'L', '限位开关'],
  ['有盘检测', 'P', '漫反射光电'], ['外检超高检测', '1', '镜反射光电'],
  ['手自动转换', '2', '转换开关'], ['上升', '3', '转换开关'],
  ['下降', '4', '转换开关'], ['正向', '5', '转换开关'],
  ['反向', '6', '转换开关'], ['急停', '7', '急停开关'],
  ['复位', '8', '按钮开关'], ['外检启动', 'Sta', '漫反射光电'],
  ['左超处', 'L', '镜反射光电'], ['右超出', 'R', '镜反射光电'],
  ['交叉1', 'X1', '镜反射光电'], ['交叉2', 'X2', '镜反射光电'],
  ['叠盘超高检测', 'H', '镜反射光电'], ['空盘确认', 'K', '按钮开关'],
  ['光幕', 'M', '光幕'], ['上减速位', 'HDec', '接近开关'],
  ['下减速位', 'Ldec', '接近开关'],
  ['Reserved', 'Reserved', '无传感器'],
];

const SEED_PROJECTS = ['埃及PCR', '埃及CUP', '国内预验收'];
const SEED_CABINETS = ['1PJ1', '1PJ2', '2GJ6'];
// [名称, PLC 前缀]  DI→I  DO→Q  AI→IW  AO→QW
const SEED_MODULE_TYPES = [['DI', 'I'], ['DO', 'Q'], ['AI', 'IW'], ['AO', 'QW']];
// [型号, 模块类型, 通道数]
const SEED_MODULE_MODELS = [
  ['1734-IB8', 'DI', 8], ['1734-IB16', 'DI', 16], ['1734-OB8', 'DO', 8],
  ['1734-OB16', 'DO', 16], ['1734-IT4', 'AI', 4], ['1734-IM4', 'AI', 4],
  ['1734-AT4', 'AO', 4], ['1734-AM4', 'AO', 4],
];
const SEED_MODULE_NOS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

/* 设备部位对照表：[显示名, 编号参数] */
const SEED_PARTS = [['现场', 'B'], ['电机', 'M']];

/* 原 Excel 24 行示例数据（保留为"埃及PCR / 柜 2GJ6 / 模块 5 / DI"的初始数据） */
const SEED_POINTS = [
  ['E13', '光幕', '_2GJ6:5:I.0'], ['E15', '光幕', '_2GJ6:5:I.1'],
  ['F32', '下限位', '_2GJ6:5:I.2'], ['F32', '上到位', '_2GJ6:5:I.3'],
  ['F32', '下到位', '_2GJ6:5:I.4'], ['F33', '停止位', '_2GJ6:5:I.5'],
  ['F34', '上到位', '_2GJ6:5:I.6'], ['F34', '下到位', '_2GJ6:5:I.7'],
  ['F35', '有盘检测', '_2GJ6:6:I.0'], ['F36', '停止位', '_2GJ6:6:I.1'],
  ['F37', '上到位', '_2GJ6:6:I.2'], ['F37', '下到位', '_2GJ6:6:I.3'],
  ['F122', '停止位', '_2GJ6:6:I.4'], ['F122', '上到位', '_2GJ6:6:I.5'],
  ['F122', '下到位', '_2GJ6:6:I.6'], ['F124', '上到位', '_2GJ6:6:I.7'],
  ['F124', '下到位', '_2GJ6:7:I.0'], ['F124', '停止位', '_2GJ6:7:I.1'],
  ['F126', '有盘检测', '_2GJ6:7:I.2'], ['E13', '有盘检测', '_2GJ6:7:I.3'],
  ['E14', '有盘检测', '_2GJ6:7:I.4'], ['E15', '有盘检测', '_2GJ6:7:I.5'],
  ['E16', '减速位', '_2GJ6:7:I.6'], ['E16', '停止位', '_2GJ6:7:I.7'],
];

function seed() {
  const now = new Date().toISOString();

  if (db.prepare('SELECT COUNT(*) c FROM signal_types').get().c === 0) {
    const ins = db.prepare(
      'INSERT INTO signal_types (name, abbr, sensor_type, no_sensor, sort_order, active) VALUES (?,?,?,?,?,1)'
    );
    SEED_SIGNAL_TYPES.forEach(([name, abbr, sensor], i) => {
      // 无传感器 / 缩写为空的类型 → 编号写 Reserved
      const noSensor = sensor === '无传感器' || abbr === '' ? 1 : 0;
      ins.run(name, abbr, sensor, noSensor, i);
    });
  }

  if (db.prepare('SELECT COUNT(*) c FROM projects').get().c === 0) {
    const ins = db.prepare('INSERT INTO projects (name, sort_order) VALUES (?,?)');
    SEED_PROJECTS.forEach((n, i) => ins.run(n, i));
  }
  if (db.prepare('SELECT COUNT(*) c FROM cabinets').get().c === 0) {
    const ins = db.prepare('INSERT INTO cabinets (name, sort_order) VALUES (?,?)');
    SEED_CABINETS.forEach((n, i) => ins.run(n, i));
  }
  if (db.prepare('SELECT COUNT(*) c FROM module_types').get().c === 0) {
    const ins = db.prepare('INSERT INTO module_types (name, plc_prefix, sort_order) VALUES (?,?,?)');
    SEED_MODULE_TYPES.forEach(([n, p], i) => ins.run(n, p, i));
  }
  if (db.prepare('SELECT COUNT(*) c FROM module_models').get().c === 0) {
    const ins = db.prepare(
      'INSERT INTO module_models (name, module_type_id, channel_count, sort_order) VALUES (?,?,?,?)'
    );
    SEED_MODULE_MODELS.forEach(([name, typeName, ch], i) => {
      const t = db.prepare('SELECT id FROM module_types WHERE name = ?').get(typeName);
      if (t) ins.run(name, t.id, ch, i);
    });
  }
  if (db.prepare('SELECT COUNT(*) c FROM module_nos').get().c === 0) {
    const ins = db.prepare('INSERT INTO module_nos (name, sort_order) VALUES (?,?)');
    SEED_MODULE_NOS.forEach((n, i) => ins.run(n, i));
  }
  if (db.prepare('SELECT COUNT(*) c FROM parts').get().c === 0) {
    const ins = db.prepare('INSERT INTO parts (name, param, sort_order, active) VALUES (?,?,?,1)');
    SEED_PARTS.forEach(([n, p], i) => ins.run(n, p, i));
  }

  // 默认管理员
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const { salt, hash } = hashPassword('admin123');
    db.prepare(
      'INSERT INTO users (username, password_hash, salt, role, must_change_pwd, created_at) VALUES (?,?,?,?,1,?)'
    ).run('admin', hash, salt, 'admin', now);

    const { salt: s2, hash: h2 } = hashPassword('user123');
    db.prepare(
      'INSERT INTO users (username, password_hash, salt, role, must_change_pwd, created_at) VALUES (?,?,?,?,0,?)'
    ).run('user', h2, s2, 'user', now);
  }

  // 原 Excel 的 24 行示例点位 → 归属 埃及PCR / 柜 2GJ6 / 模块 5 / DI(1734-IB8)
  if (db.prepare('SELECT COUNT(*) c FROM modules').get().c === 0) {
    const pid = db.prepare("SELECT id FROM projects WHERE name='埃及PCR'").get();
    const cab = db.prepare("SELECT id FROM cabinets WHERE name='2GJ6'").get();
    const mt = db.prepare("SELECT id FROM module_types WHERE name='DI'").get();
    const mm = db.prepare("SELECT id FROM module_models WHERE name='1734-IB8'").get();
    if (pid && cab && mt && mm) {
      const mid = db.prepare(
        'INSERT INTO modules (project_id, cabinet_id, module_no, module_type_id, module_model_id, note, created_at) VALUES (?,?,?,?,?,?,?)'
      ).run(pid.id, cab.id, '5', mt.id, mm.id, '由原 Excel 示例数据导入', now).lastInsertRowid;

      const ins = db.prepare(
        'INSERT INTO points (project_id, module_id, part, point_name, signal_type_id, plc_point, sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      );
      SEED_POINTS.forEach(([pt, sigName, plc], i) => {
        const sig = db.prepare('SELECT id FROM signal_types WHERE name = ?').get(sigName);
        ins.run(pid.id, mid, 'B', pt, sig ? sig.id : null, plc, i, now);
      });
    }
  }
}

/* module_nos 是种子用的模块号选项表（延迟创建以兼容旧库） */
function ensureModuleNosTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS module_nos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );`);
}

ensureModuleNosTable();
seed();
// 按项目中的柜子限制模块号；保留历史记录，仅阻止新增或改号造成重复。
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_modules_cabinet_number ON modules(project_id, cabinet_id, module_no);
  CREATE TRIGGER IF NOT EXISTS modules_unique_number_insert
  BEFORE INSERT ON modules
  WHEN EXISTS (SELECT 1 FROM modules WHERE project_id=NEW.project_id AND cabinet_id=NEW.cabinet_id AND module_no=NEW.module_no)
  BEGIN SELECT RAISE(ABORT, '柜子内模块号不能重复'); END;
  CREATE TRIGGER IF NOT EXISTS modules_unique_number_update
  BEFORE UPDATE OF project_id, cabinet_id, module_no ON modules
  WHEN EXISTS (SELECT 1 FROM modules WHERE project_id=NEW.project_id AND cabinet_id=NEW.cabinet_id AND module_no=NEW.module_no AND id<>OLD.id)
  BEGIN SELECT RAISE(ABORT, '柜子内模块号不能重复'); END;
`);
if (!db.prepare('PRAGMA table_info(signal_types)').all().some(column => column.name === 'program_name')) {
  db.exec("ALTER TABLE signal_types ADD COLUMN program_name TEXT NOT NULL DEFAULT ''");
}
db.exec(`CREATE TABLE IF NOT EXISTS project_cabinet_order (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cabinet_id INTEGER NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (project_id, cabinet_id)
);`);

// 一次性迁移：现有信号类型统一归到「现场」，后续启动保留管理员的修改。
if (!db.prepare('PRAGMA table_info(signal_types)').all().some((column) => column.name === 'part_id')) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE signal_types ADD COLUMN part_id INTEGER REFERENCES parts(id)');
    const fieldPart = db.prepare("SELECT id FROM parts WHERE name = '现场'").get();
    if (!fieldPart) throw new Error('信号类型部位迁移失败：缺少现场部位');
    db.prepare('UPDATE signal_types SET part_id = ?').run(fieldPart.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 编号规则 —— 复刻原 Excel 公式 + 新增 Reserved 默认值                    */
/*   传感器类型 = VLOOKUP(信号类型, 配置表, 3, FALSE)                      */
/*   编号       = IF(OR(部位="",点位="",信号类型=""), "Reserved",            */
/*                  "_"&部位&"_"&点位&"_"&简写)          ← 未填写即 Reserved  */
/*   无传感器通道 → Reserved                                                */
/* ------------------------------------------------------------------ */
function computeSensorType(signalType) {
  if (!signalType) return '';
  return signalType.sensor_type || '';
}

function computeCode(part, pointName, signalType) {
  const p = (part || '').trim();
  const n = (pointName || '').trim();
  // 部位 / 点位 / 信号类型 任一未填写 → 编号默认 Reserved
  if (!p || !n || !signalType) return 'Reserved';
  // 明确标记为无传感器的通道 → Reserved
  if (signalType.no_sensor || !signalType.abbr) return 'Reserved';
  return `_${p}_${n}_${signalType.abbr}`;
}

/** PLC 点位：_ + 柜子号 + : + 模块号 + : + PLC前缀 + . + 通道序号 */
function computePlcPoint(cabinetName, moduleNo, plcPrefix, channelIndex) {
  if (!cabinetName || moduleNo === '' || moduleNo === null) return '';
  return `_${cabinetName}:${moduleNo}:${plcPrefix || 'I'}.${channelIndex}`;
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function computePlcExpression({ programName, pointName, signalTypeId, address, moduleType, plcPrefix }) {
  const program = String(programName || '').trim();
  const point = String(pointName || '').trim();
  const plc = String(address || '').trim().replace(/:Q(?=W?\.)/g, ':O');
  const type = String(moduleType || '').trim().toUpperCase();
  if (plc && (!point || !signalTypeId)) {
    if (type === 'DI') return `//Spare:=${plc};`;
    if (type === 'DO') return `//${plc}:=Spare;`;
  }
  if (!program || !point || !plc) return plc;
  const prefix = String(plcPrefix || '').trim().toUpperCase();
  let output;
  if (['DI', 'AI'].includes(type) || type.includes('输入')) output = false;
  else if (['DO', 'AO'].includes(type) || type.includes('输出')) output = true;
  else if (prefix.startsWith('I')) output = false;
  else if (prefix.startsWith('Q')) output = true;
  else return plc;
  const numberedPoint = point.match(/^([A-Za-z])(\d+)$/);
  const expressionPoint = numberedPoint ? `${numberedPoint[1]}${numberedPoint[2].padStart(5, '0')}` : point;
  const variable = `${program}_${expressionPoint}`;
  return output ? `${plc}:=${variable};` : `${variable}:=${plc};`;
}

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  computeSensorType,
  computeCode,
  computePlcPoint,
  computePlcExpression,
  purgeExpiredSessions,
  DB_PATH,
};
