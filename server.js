'use strict';
/**
 * 现场设备点位表系统 —— HTTP 服务端（零第三方依赖）
 *  - 静态资源托管 + PWA
 *  - Cookie 会话鉴权（普通用户 / 管理员）
 *  - REST API
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  db, hashPassword, verifyPassword,
  computeSensorType, computeCode, computePlcPoint, computePlcExpression, purgeExpiredSessions,
} = require('./db');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 小时
const COOKIE_NAME = 'spt_sid';
const mobileSync = require('./sync-core');
mobileSync.install(db);

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function str(v, max = 200) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max);
}

function intOrNull(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)')
    .run(token, userId, now + SESSION_TTL, new Date(now).toISOString());
  return token;
}

function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.must_change_pwd, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.disabled = 0
  `).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, username: row.username, role: row.role, mustChangePwd: !!row.must_change_pwd };
}

/* 登录限流：同一用户名/IP 连续失败冷却 */
const loginAttempts = new Map();
function throttled(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (Date.now() > rec.until) { loginAttempts.delete(key); return false; }
  return rec.count >= 5;
}
function noteFail(key) {
  const rec = loginAttempts.get(key) || { count: 0, until: 0 };
  rec.count += 1;
  rec.until = Date.now() + 5 * 60 * 1000;
  if (rec.count >= 5) rec.count = 5;
  loginAttempts.set(key, rec);
}
function clearFail(key) { loginAttempts.delete(key); }

/* ------------------------------------------------------------------ */
/* 领域逻辑：读取 + 组装                                               */
/* ------------------------------------------------------------------ */
function listSignalTypes({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM signal_types WHERE active = 1 ORDER BY sort_order, id'
    : 'SELECT * FROM signal_types ORDER BY sort_order, id';
  return db.prepare(sql).all().map((s) => ({ ...s, no_sensor: !!s.no_sensor, active: !!s.active }));
}

function signalTypeById(id) {
  const r = db.prepare('SELECT * FROM signal_types WHERE id = ?').get(id);
  return r ? { ...r, no_sensor: !!r.no_sensor, active: !!r.active } : null;
}

function signalMatchesPart(signalId, part) {
  return !!db.prepare(`SELECT st.id FROM signal_types st JOIN parts p ON p.id = st.part_id
    WHERE st.id = ? AND st.active = 1 AND p.active = 1 AND p.param = ?`).get(signalId, part);
}

function signalMatchesModule(signalId, module) {
  const type = String(module?.module_type_name || '').trim().toUpperCase();
  return !['DI', 'DO'].includes(type) || signalTypeById(signalId)?.name.trim().toUpperCase().endsWith(type);
}

function listOptions() {
  return {
    projects: db.prepare('SELECT * FROM projects ORDER BY sort_order, id').all(),
    cabinets: db.prepare('SELECT * FROM cabinets ORDER BY sort_order, id').all(),
    module_types: db.prepare('SELECT * FROM module_types ORDER BY sort_order, id').all(),
    module_models: db.prepare(`
      SELECT mm.*, mt.name AS module_type_name, mt.plc_prefix
      FROM module_models mm JOIN module_types mt ON mt.id = mm.module_type_id
      ORDER BY mt.sort_order, mm.sort_order, mm.id
    `).all(),
    module_nos: db.prepare('SELECT * FROM module_nos ORDER BY sort_order, id').all(),
    parts: db.prepare('SELECT * FROM parts WHERE active = 1 ORDER BY sort_order, id').all(),
  };
}

/** 项目 → 柜子 → 模块 三级树，含各层点位统计
    注意：柜子号是全局选项（不属于某个项目），同一柜可出现在多个项目下 */
function projectTree() {
  const projects = db.prepare('SELECT id, name FROM projects ORDER BY sort_order, id').all();
  const cabinets = db.prepare('SELECT id, name FROM cabinets ORDER BY sort_order, id').all();
  const cabinetOrder = new Map(db.prepare('SELECT * FROM project_cabinet_order').all()
    .map(row => [`${row.project_id}:${row.cabinet_id}`, row.sort_order]));
  const modules = db.prepare(`
    SELECT m.id, m.project_id, m.cabinet_id, m.module_no, m.note, m.created_by,
           mt.name AS module_type_name, mm.name AS module_model_name, mm.channel_count,
           u.username AS created_by_name,
           (SELECT COUNT(*) FROM points pt WHERE pt.module_id = m.id) AS point_count,
           (SELECT COUNT(*) FROM points pt WHERE pt.module_id = m.id AND pt.signal_type_id IS NULL) AS unfilled_count,
           (SELECT COUNT(*) FROM points pt WHERE pt.module_id = m.id AND TRIM(pt.part) <> ''
             AND TRIM(pt.point_name) <> '' AND pt.signal_type_id IS NOT NULL) AS configured_point_count
    FROM modules m
    JOIN module_types mt ON mt.id = m.module_type_id
    JOIN module_models mm ON mm.id = m.module_model_id
    LEFT JOIN users u     ON u.id  = m.created_by
  `).all();

  return projects.map((p) => {
    const myMods = modules.filter((m) => m.project_id === p.id);
    // 按柜子聚合：优先使用项目内排序，未排序的柜子沿用全局顺序。
    const usedCabIds = [...new Set(myMods.map((m) => m.cabinet_id))];
    const cs = cabinets
      .filter((c) => usedCabIds.includes(c.id))
      .sort((a, b) => (cabinetOrder.get(`${p.id}:${a.id}`) ?? Number.MAX_SAFE_INTEGER)
        - (cabinetOrder.get(`${p.id}:${b.id}`) ?? Number.MAX_SAFE_INTEGER) || a.sort_order - b.sort_order || a.id - b.id)
      .map((c) => {
        const ms = myMods
          .filter((m) => m.cabinet_id === c.id)
          .sort((a, b) => (parseInt(a.module_no, 10) || 0) - (parseInt(b.module_no, 10) || 0)
            || a.module_no.localeCompare(b.module_no) || a.id - b.id)
          .map((m) => ({
            id: m.id,
            module_no: m.module_no,
            note: m.note,
            created_by: m.created_by,
            created_by_name: m.created_by_name || '（已删除账号）',
            module_type_name: m.module_type_name,
            module_model_name: m.module_model_name,
            channel_count: m.channel_count,
            point_count: m.point_count,
            unfilled_count: m.unfilled_count,
            configured_point_count: m.configured_point_count,
          }));
        return {
          id: c.id, name: c.name, modules: ms,
          module_count: ms.length,
          point_count: ms.reduce((s, m) => s + m.point_count, 0),
        };
      });
    return {
      id: p.id, name: p.name, cabinets: cs,
      module_count: cs.reduce((s, c) => s + c.module_count, 0),
      point_count: cs.reduce((s, c) => s + c.point_count, 0),
    };
  });
}

function moduleWithMeta(id) {
  return db.prepare(`
    SELECT m.*, p.name AS project_name, c.name AS cabinet_name,
           mt.name AS module_type_name, mt.plc_prefix, mm.name AS module_model_name, mm.channel_count,
           u.username AS created_by_name
    FROM modules m
    JOIN projects p     ON p.id  = m.project_id
    JOIN cabinets c     ON c.id  = m.cabinet_id
    JOIN module_types mt ON mt.id = m.module_type_id
    JOIN module_models mm ON mm.id = m.module_model_id
    LEFT JOIN users u    ON u.id  = m.created_by
    WHERE m.id = ?
  `).get(id);
}

/**
 * 模块操作权限：
 *  - 未登录访客：任意模块
 *  - 访客模块（无创建者）：共享管理
 *  - 管理员：任意模块
 *  - 普通用户：仅自己创建的模块
 */
function canManageModule(user, module) {
  if (!module) return false;
  if (module.created_by == null) return true;
  if (!user) return true;
  if (user.role === 'admin') return true;
  return module.created_by === user.id;
}

function listModules(projectId) {
  const sql = `
    SELECT m.*, p.name AS project_name, c.name AS cabinet_name,
           mt.name AS module_type_name, mt.plc_prefix, mm.name AS module_model_name, mm.channel_count,
           u.username AS created_by_name,
           (SELECT COUNT(*) FROM points pt WHERE pt.module_id = m.id) AS point_count
    FROM modules m
    JOIN projects p      ON p.id  = m.project_id
    JOIN cabinets c      ON c.id  = m.cabinet_id
    JOIN module_types mt ON mt.id = m.module_type_id
    JOIN module_models mm ON mm.id = m.module_model_id
    LEFT JOIN users u    ON u.id  = m.created_by
    ${projectId ? 'WHERE m.project_id = ?' : ''}
    ORDER BY m.project_id, c.name, CAST(m.module_no AS INTEGER), m.module_no, m.id
  `;
  return projectId ? db.prepare(sql).all(projectId) : db.prepare(sql).all();
}

/** 组装点位行：传感器类型 / 编号 由数据库配置实时推导（复刻 Excel 公式） */
function listPoints({ projectId, moduleId } = {}) {
  const where = [];
  const args = [];
  if (moduleId) { where.push('pt.module_id = ?'); args.push(moduleId); }
  else if (projectId) { where.push('pt.project_id = ?'); args.push(projectId); }
  const sql = `
    SELECT pt.*, st.name AS signal_name, st.abbr AS signal_abbr,
           st.sensor_type AS signal_sensor, st.no_sensor AS st_no_sensor,
           m.cabinet_id, m.module_no, m.module_type_id, m.module_model_id,
           c.name AS cabinet_name, mt.plc_prefix, mt.name AS module_type_name, st.program_name
    FROM points pt
    LEFT JOIN signal_types st ON st.id = pt.signal_type_id
    LEFT JOIN modules m        ON m.id  = pt.module_id
    LEFT JOIN cabinets c       ON c.id  = m.cabinet_id
    LEFT JOIN module_types mt  ON mt.id = m.module_type_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pt.module_id IS NULL, pt.module_id, pt.sort_order, pt.id
  `;
  const rows = db.prepare(sql).all(...args);
  // 序号：只对「设备部位」已填的行计数（复刻原表 COUNTA($B$2:$B2)）
  let seq = 0;
  return rows.map((r) => {
    if ((r.part || '').trim()) seq += 1;
    const sig = r.signal_name ? {
      name: r.signal_name, abbr: r.signal_abbr,
      sensor_type: r.signal_sensor, no_sensor: !!r.st_no_sensor,
    } : null;
    return {
      id: r.id,
      seq: (r.part || '').trim() ? seq : '',
      project_id: r.project_id,
      module_id: r.module_id,
      part: r.part,
      point_name: r.point_name,
      signal_type_id: r.signal_type_id,
      signal_name: r.signal_name || '',
      sensor_type: computeSensorType(sig),
      code: computeCode(r.part, r.point_name, sig),
      plc_point: r.plc_point,
      plc_expression: computePlcExpression({ programName: r.program_name, pointName: r.point_name,
        signalTypeId: r.signal_type_id,
        address: r.plc_point, moduleType: r.module_type_name, plcPrefix: r.plc_prefix }),
      sort_order: r.sort_order,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 路由表                                                              */
/* ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  // 现场业务允许免登录；配置和账号接口继续使用会话与管理员校验。
  if (/^\/api\/(modules|points)(\/|$)/.test(pattern)) opts = { public: true, ...opts };
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => {
    keys.push(k); return '([^/]+)';
  }) + '$');
  routes.push({ method, rx, keys, handler, ...opts });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.rx);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { r, params };
  }
  return null;
}

/* ============================ 认证 API ============================ */

function mobileAuthorized(req) {
  const expected = process.env.MOBILE_SYNC_TOKEN || '';
  const actual = String(req.headers['x-mobile-sync-token'] || '');
  if (expected.length < 32 || Buffer.byteLength(actual) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function mobileSnapshot() {
  const names = [...mobileSync.tables, 'users'];
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type='table' ORDER BY rowid").all()
    .filter(r => names.some(t => new RegExp('CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?["`]?'+t+'["`]?\\s*\\(', 'i').test(r.sql)))
    .map(r => r.sql);
  const guards = db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('modules_unique_number_insert','modules_unique_number_update','idx_parts_param')").all().map(r=>r.sql);
  return { version:1, server_time:Date.now(), schema:[...schema,...guards], records:mobileSync.snapshot(db) };
}
route('GET', '/api/mobile/sync', async ({req,res}) => {
  if(!mobileAuthorized(req)) return sendJson(res,401,{error:'需要有效的移动端同步密钥'});
  sendJson(res,200,mobileSnapshot());
}, {public:true});
route('POST', '/api/mobile/sync', async ({req,res}) => {
  if(!mobileAuthorized(req)) return sendJson(res,401,{error:'需要有效的移动端同步密钥'});
  const body=await readBody(req,20*1024*1024);
  if(body.version!==1) return sendJson(res,400,{error:'同步协议版本不兼容'});
  try {
    const merged=mobileSync.merge(db,body.records,{validate:mobileSync.validateBusiness});
    sendJson(res,200,{...mobileSnapshot(),merged});
  } catch(e) { sendJson(res,409,{error:'同步未提交，请处理数据冲突后重试：'+e.message}); }
}, {public:true});

route('POST', '/api/auth/login', async ({ req, res, ip }) => {
  const key = ip;
  if (throttled(key)) {
    return sendJson(res, 429, { error: '尝试次数过多，请 5 分钟后再试' });
  }
  const body = await readBody(req);
  const username = str(body.username, 64).trim();
  const password = str(body.password, 200);
  if (!username || !password) return sendJson(res, 400, { error: '请输入用户名和密码' });

  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = u && !u.disabled && verifyPassword(password, u.salt, u.password_hash);
  if (!ok) {
    noteFail(key);
    return sendJson(res, 401, { error: '用户名或密码错误' });
  }
  clearFail(key);
  const token = createSession(u.id);
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
  sendJson(res, 200, {
    user: { id: u.id, username: u.username, role: u.role, mustChangePwd: !!u.must_change_pwd },
  });
}, { public: true });

route('POST', '/api/auth/logout', async ({ req, res }) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  sendJson(res, 200, { ok: true });
}, { public: true });

/* ============================ 自助注册 ============================ */
const REGISTER_ENABLED = process.env.ALLOW_REGISTER !== '0';

route('GET', '/api/auth/register-status', async ({ res }) => {
  sendJson(res, 200, { enabled: REGISTER_ENABLED });
}, { public: true });

route('POST', '/api/auth/register', async ({ req, res, ip }) => {
  if (!REGISTER_ENABLED) return sendJson(res, 403, { error: '管理员已关闭自助注册，请联系管理员开通账号' });
  if (throttled('reg:' + ip)) return sendJson(res, 429, { error: '注册尝试过多，请稍后再试' });

  const body = await readBody(req);
  const username = str(body.username, 64).trim();
  const password = str(body.password, 200);
  const confirm = str(body.confirmPassword, 200);

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return sendJson(res, 400, { error: '用户名需为 3–32 位字母、数字、下划线、点或短横线' });
  }
  if (password.length < 6) return sendJson(res, 400, { error: '密码至少 6 位' });
  if (password !== confirm) return sendJson(res, 400, { error: '两次输入的密码不一致' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return sendJson(res, 409, { error: '该用户名已被注册' });
  }

  const { salt, hash } = hashPassword(password);
  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, salt, role, must_change_pwd, disabled, created_at) VALUES (?,?,?,?,1,0,?)'
    ).run(username, hash, salt, 'user', new Date().toISOString());
    clearFail('reg:' + ip);
    sendJson(res, 200, {
      ok: true,
      user: { id: Number(info.lastInsertRowid), username, role: 'user', mustChangePwd: true },
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return sendJson(res, 409, { error: '该用户名已被注册' });
    }
    throw err;
  }
}, { public: true });

route('GET', '/api/auth/me', async ({ user, res }) => {
  sendJson(res, 200, { user });
}, { public: true });

route('POST', '/api/auth/password', async ({ req, res, user }) => {
  const body = await readBody(req);
  const oldPwd = str(body.oldPassword, 200);
  const newPwd = str(body.newPassword, 200);
  if (newPwd.length < 6) return sendJson(res, 400, { error: '新密码至少 6 位' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!verifyPassword(oldPwd, u.salt, u.password_hash)) {
    return sendJson(res, 400, { error: '原密码不正确' });
  }
  const { salt, hash } = hashPassword(newPwd);
  db.prepare('UPDATE users SET password_hash=?, salt=?, must_change_pwd=0 WHERE id=?')
    .run(hash, salt, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
    .run(user.id, parseCookies(req)[COOKIE_NAME] || '');
  sendJson(res, 200, { ok: true });
});

/* ============================ 信号类型配置（管理员） ============================ */

route('GET', '/api/signal-types', async ({ res, user }) => {
  sendJson(res, 200, {
    items: listSignalTypes({ activeOnly: !user || user.role !== 'admin' }),
    canEdit: !!user && user.role === 'admin',
  });
}, { public: true });

route('POST', '/api/signal-types', async ({ req, res }) => {
  const b = await readBody(req);
  const name = str(b.name, 64).trim();
  if (!name) return sendJson(res, 400, { error: '信号类型名称不能为空' });
  const abbr = str(b.abbr, 64).trim();
  const sensor = str(b.sensor_type, 64).trim();
  const programName = str(b.program_name, 200).trim();
  const partId = intOrNull(b.part_id);
  if (!partId || !db.prepare('SELECT id FROM parts WHERE id = ? AND active = 1').get(partId)) {
    return sendJson(res, 400, { error: '请选择有效的所属设备部位' });
  }
  const noSensor = b.no_sensor ? 1 : (!abbr || sensor === '无传感器' ? 1 : 0);
  if (db.prepare('SELECT id FROM signal_types WHERE name = ?').get(name)) {
    return sendJson(res, 409, { error: '该信号类型已存在' });
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM signal_types').get().m;
  const info = db.prepare(
    'INSERT INTO signal_types (name, abbr, sensor_type, no_sensor, sort_order, active, part_id, program_name) VALUES (?,?,?,?,?,1,?,?)'
  ).run(name, abbr, sensor, noSensor, max + 1, partId, programName);
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
}, { admin: true });

route('PUT', '/api/signal-types/:id', async ({ req, res, params }) => {
  const id = intOrNull(params.id);
  const cur = signalTypeById(id);
  if (!cur) return sendJson(res, 404, { error: '记录不存在' });
  const b = await readBody(req);
  const name = b.name === undefined ? cur.name : str(b.name, 64).trim();
  if (!name) return sendJson(res, 400, { error: '信号类型名称不能为空' });
  const abbr = b.abbr === undefined ? cur.abbr : str(b.abbr, 64).trim();
  const sensor = b.sensor_type === undefined ? cur.sensor_type : str(b.sensor_type, 64).trim();
  const programName = b.program_name === undefined ? cur.program_name : str(b.program_name, 200).trim();
  const noSensor = b.no_sensor === undefined
    ? (cur.no_sensor ? 1 : (!abbr || sensor === '无传感器' ? 1 : 0))
    : (b.no_sensor ? 1 : 0);
  const active = b.active === undefined ? (cur.active ? 1 : 0) : (b.active ? 1 : 0);
  const sort = b.sort_order === undefined ? cur.sort_order : Number(b.sort_order) || 0;
  const partId = b.part_id === undefined ? cur.part_id : intOrNull(b.part_id);
  if (b.part_id !== undefined && (!partId || !db.prepare('SELECT id FROM parts WHERE id = ? AND active = 1').get(partId))) {
    return sendJson(res, 400, { error: '请选择有效的所属设备部位' });
  }
  const dup = db.prepare('SELECT id FROM signal_types WHERE name = ? AND id != ?').get(name, id);
  if (dup) return sendJson(res, 409, { error: '该信号类型名称已存在' });
  db.prepare(
    'UPDATE signal_types SET name=?, abbr=?, sensor_type=?, no_sensor=?, sort_order=?, active=?, part_id=?, program_name=? WHERE id=?'
  ).run(name, abbr, sensor, noSensor, sort, active, partId, programName, id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('DELETE', '/api/signal-types/:id', async ({ res, params }) => {
  const id = intOrNull(params.id);
  const used = db.prepare('SELECT COUNT(*) c FROM points WHERE signal_type_id = ?').get(id).c;
  if (used > 0) {
    return sendJson(res, 409, { error: `该信号类型已被 ${used} 个点位使用，请先改为「停用」` });
  }
  db.prepare('DELETE FROM signal_types WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('POST', '/api/signal-types/reorder', async ({ req, res }) => {
  const b = await readBody(req);
  const { ids } = b;
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return sendJson(res, 400, { error: '信号类型排序数据无效' });
  }
  const current = db.prepare('SELECT id FROM signal_types').all();
  if (ids.length !== current.length || current.some(signal => !ids.includes(signal.id))) {
    return sendJson(res, 409, { error: '信号类型列表已变化，请刷新后重新排序' });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare('UPDATE signal_types SET sort_order = ? WHERE id = ?');
    ids.forEach((id, index) => update.run(index, id));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  sendJson(res, 200, { ok: true });
}, { admin: true });

/* ============================ 基础选项配置（管理员） ============================ */

const OPTION_TABLES = {
  projects: 'projects',
  cabinets: 'cabinets',
  module_types: 'module_types',
  module_nos: 'module_nos',
};

route('POST', '/api/config/projects/reorder', async ({ req, res }) => {
  const { ids } = await readBody(req);
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return sendJson(res, 400, { error: '项目排序数据无效' });
  }
  const projects = db.prepare('SELECT id FROM projects').all();
  if (ids.length !== projects.length || projects.some(p => !ids.includes(p.id))) {
    return sendJson(res, 409, { error: '项目列表已变化，请刷新后重新排序' });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
    ids.forEach((id, index) => update.run(index, id));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('GET', '/api/config', async ({ res, user }) => {
  sendJson(res, 200, { ...listOptions(), canEdit: !!user && user.role === 'admin' });
}, { public: true });

/* ============================ 项目树 ============================ */
route('POST', '/api/projects/:id/cabinets/reorder', async ({ req, res, params }) => {
  const projectId = intOrNull(params.id);
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) return sendJson(res, 404, { error: '项目不存在' });
  const { ids } = await readBody(req);
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return sendJson(res, 400, { error: '柜子排序数据无效' });
  }
  const current = db.prepare('SELECT DISTINCT cabinet_id AS id FROM modules WHERE project_id=?').all(projectId);
  if (ids.length !== current.length || current.some(c => !ids.includes(c.id))) return sendJson(res, 409, { error: '项目中的柜子已变化，请刷新后重新排序' });
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT INTO project_cabinet_order(project_id,cabinet_id,sort_order) VALUES(?,?,?) ON CONFLICT(project_id,cabinet_id) DO UPDATE SET sort_order=excluded.sort_order');
    ids.forEach((id, index) => insert.run(projectId, id, index));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  sendJson(res, 200, { ok: true });
}, { public: true });
route('GET', '/api/tree', async ({ res, user }) => {
  const tree = projectTree();
  // 标注当前用户对每个模块的权限，前端据此决定是否显示删除按钮
  tree.forEach((p) => p.cabinets.forEach((c) => c.modules.forEach((m) => {
    m.can_manage = canManageModule(user, m);
    m.mine = !!(user && m.created_by === user.id);
  })));
  sendJson(res, 200, { projects: tree });
}, { public: true });

/* ============================ 设备部位对照（管理员） ============================ */
route('POST', '/api/config/parts', async ({ req, res }) => {
  const b = await readBody(req);
  const name = str(b.name, 32).trim();
  const param = str(b.param, 8).trim();
  if (!name) return sendJson(res, 400, { error: '部位名称不能为空' });
  if (!param) return sendJson(res, 400, { error: '编号参数不能为空' });
  if (db.prepare('SELECT id FROM parts WHERE name = ? AND active = 1').get(name)) {
    return sendJson(res, 409, { error: '该部位名称已存在' });
  }
  if (db.prepare('SELECT id FROM parts WHERE param = ? AND active = 1').get(param)) {
    return sendJson(res, 409, { error: `编号参数「${param}」已被占用` });
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM parts').get().m;
  const info = db.prepare('INSERT INTO parts (name, param, sort_order, active) VALUES (?,?,?,1)')
    .run(name, param, max + 1);
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
}, { admin: true });

route('PUT', '/api/config/parts/:id', async ({ req, res, params }) => {
  const id = intOrNull(params.id);
  const cur = db.prepare('SELECT * FROM parts WHERE id = ?').get(id);
  if (!cur) return sendJson(res, 404, { error: '记录不存在' });
  const b = await readBody(req);
  const name = b.name === undefined ? cur.name : str(b.name, 32).trim();
  const param = b.param === undefined ? cur.param : str(b.param, 8).trim();
  if (!name) return sendJson(res, 400, { error: '部位名称不能为空' });
  if (!param) return sendJson(res, 400, { error: '编号参数不能为空' });
  if (db.prepare('SELECT id FROM parts WHERE name = ? AND id != ? AND active = 1').get(name, id)) {
    return sendJson(res, 409, { error: '该部位名称已存在' });
  }
  if (db.prepare('SELECT id FROM parts WHERE param = ? AND id != ? AND active = 1').get(param, id)) {
    return sendJson(res, 409, { error: `编号参数「${param}」已被占用` });
  }
  db.prepare('UPDATE parts SET name = ?, param = ? WHERE id = ?').run(name, param, id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('DELETE', '/api/config/parts/:id', async ({ res, params }) => {
  const id = intOrNull(params.id);
  const signals = db.prepare('SELECT COUNT(*) c FROM signal_types WHERE part_id = ?').get(id).c;
  if (signals > 0) return sendJson(res, 409, { error: `该部位已用于 ${signals} 个信号类型，无法删除` });
  const c = db.prepare('SELECT COUNT(*) c FROM points WHERE part = (SELECT param FROM parts WHERE id = ?)').get(id).c;
  if (c > 0) return sendJson(res, 409, { error: `该部位已用于 ${c} 个点位，无法删除` });
  // 有历史引用的改为停用，保留数据
  const used = db.prepare('SELECT COUNT(*) c FROM points WHERE part = (SELECT param FROM parts WHERE id = ?)').get(id).c;
  if (used > 0) {
    db.prepare('UPDATE parts SET active = 0 WHERE id = ?').run(id);
  } else {
    db.prepare('DELETE FROM parts WHERE id = ?').run(id);
  }
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('POST', '/api/config/:kind', async ({ req, res, params }) => {
  const table = OPTION_TABLES[params.kind];
  if (!table) return sendJson(res, 404, { error: '未知配置类型' });
  const b = await readBody(req);
  const name = str(b.name, 64).trim();
  if (!name) return sendJson(res, 400, { error: '名称不能为空' });
  if (db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name)) {
    return sendJson(res, 409, { error: '该选项已存在' });
  }
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM ${table}`).get().m;
  let info;
  if (table === 'module_types') {
    const prefix = str(b.plc_prefix, 16).trim() || 'I';
    info = db.prepare(`INSERT INTO module_types (name, plc_prefix, sort_order) VALUES (?,?,?)`)
      .run(name, prefix, max + 1);
  } else {
    info = db.prepare(`INSERT INTO ${table} (name, sort_order) VALUES (?,?)`).run(name, max + 1);
  }
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
}, { admin: true });

route('PUT', '/api/config/:kind/:id', async ({ req, res, params }) => {
  const table = OPTION_TABLES[params.kind];
  if (!table) return sendJson(res, 404, { error: '未知配置类型' });
  const id = intOrNull(params.id);
  const b = await readBody(req);
  const name = str(b.name, 64).trim();
  if (!name) return sendJson(res, 400, { error: '名称不能为空' });
  if (db.prepare(`SELECT id FROM ${table} WHERE name = ? AND id != ?`).get(name, id)) {
    return sendJson(res, 409, { error: '该选项已存在' });
  }
  if (table === 'module_types') {
    const prefix = str(b.plc_prefix, 16).trim() || 'I';
    db.prepare('UPDATE module_types SET name=?, plc_prefix=? WHERE id=?').run(name, prefix, id);
  } else {
    db.prepare(`UPDATE ${table} SET name=? WHERE id=?`).run(name, id);
  }
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('DELETE', '/api/config/:kind/:id', async ({ req, res, params }) => {
  const table = OPTION_TABLES[params.kind];
  if (!table) return sendJson(res, 404, { error: '未知配置类型' });
  const id = intOrNull(params.id);
  // 在用校验
  const usage = {
    projects: ['SELECT COUNT(*) c FROM modules WHERE project_id = ?', '项目'],
    cabinets: ['SELECT COUNT(*) c FROM modules WHERE cabinet_id = ?', '柜子号'],
    module_types: ['SELECT COUNT(*) c FROM modules WHERE module_type_id = ?', '模块类型'],
    module_nos: ['SELECT COUNT(*) c FROM modules WHERE module_no = ?', '模块号'],
  }[table];
  if (usage) {
    const c = db.prepare(usage[0]).get(table === 'module_nos' ? String(id) : id).c;
    if (c > 0) return sendJson(res, 409, { error: `该${usage[1]}已被 ${c} 个模块使用，无法删除` });
  }
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

/* 模块型号：独立端点（带 module_type_id / channel_count） */
route('POST', '/api/module-models', async ({ req, res }) => {
  const b = await readBody(req);
  const name = str(b.name, 64).trim();
  const typeId = intOrNull(b.module_type_id);
  const ch = Number(b.channel_count);
  if (!name || !typeId) return sendJson(res, 400, { error: '请填写模块型号并选择模块类型' });
  if (!Number.isInteger(ch) || ch < 1 || ch > 256) {
    return sendJson(res, 400, { error: '总通道数需为 1–256 的整数' });
  }
  if (db.prepare('SELECT id FROM module_models WHERE name = ?').get(name)) {
    return sendJson(res, 409, { error: '该型号已存在' });
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM module_models').get().m;
  const info = db.prepare(
    'INSERT INTO module_models (name, module_type_id, channel_count, sort_order) VALUES (?,?,?,?)'
  ).run(name, typeId, ch, max + 1);
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
}, { admin: true });

route('PUT', '/api/module-models/:id', async ({ req, res, params }) => {
  const id = intOrNull(params.id);
  const cur = db.prepare('SELECT * FROM module_models WHERE id = ?').get(id);
  if (!cur) return sendJson(res, 404, { error: '记录不存在' });
  const b = await readBody(req);
  const name = b.name === undefined ? cur.name : str(b.name, 64).trim();
  const typeId = b.module_type_id === undefined ? cur.module_type_id : intOrNull(b.module_type_id);
  const ch = b.channel_count === undefined ? cur.channel_count : Number(b.channel_count);
  if (!name || !typeId) return sendJson(res, 400, { error: '请填写模块型号并选择模块类型' });
  if (!Number.isInteger(ch) || ch < 1 || ch > 256) {
    return sendJson(res, 400, { error: '总通道数需为 1–256 的整数' });
  }
  db.prepare('UPDATE module_models SET name=?, module_type_id=?, channel_count=? WHERE id=?')
    .run(name, typeId, ch, id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('DELETE', '/api/module-models/:id', async ({ res, params }) => {
  const id = intOrNull(params.id);
  const c = db.prepare('SELECT COUNT(*) c FROM modules WHERE module_model_id = ?').get(id).c;
  if (c > 0) return sendJson(res, 409, { error: `该型号已被 ${c} 个模块使用，无法删除` });
  db.prepare('DELETE FROM module_models WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

/* ============================ 模块 ============================ */

route('GET', '/api/modules', async ({ res, url }) => {
  const pid = intOrNull(url.searchParams.get('project_id'));
  sendJson(res, 200, { items: listModules(pid) });
}, { public: true });

route('POST', '/api/modules', async ({ req, res, user }) => {
  const b = await readBody(req);
  const projectId = intOrNull(b.project_id);
  const cabinetId = intOrNull(b.cabinet_id);
  const moduleNo = str(b.module_no, 32).trim();
  const typeId = intOrNull(b.module_type_id);
  const modelId = intOrNull(b.module_model_id);

  const project = projectId && db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const cabinet = cabinetId && db.prepare('SELECT * FROM cabinets WHERE id = ?').get(cabinetId);
  const mtype = typeId && db.prepare('SELECT * FROM module_types WHERE id = ?').get(typeId);
  const model = modelId && db.prepare('SELECT * FROM module_models WHERE id = ?').get(modelId);
  if (!project || !cabinet || !mtype || !model) {
    return sendJson(res, 400, { error: '项目名称、柜子号、模块类型、模块型号均为必选' });
  }
  if (!moduleNo) return sendJson(res, 400, { error: '模块号为必选' });
  if (model.module_type_id !== mtype.id) {
    return sendJson(res, 400, { error: `模块型号「${model.name}」不属于模块类型「${mtype.name}」，请重新选择` });
  }

  const now = new Date().toISOString();
  const dup = db.prepare(
    'SELECT id FROM modules WHERE project_id=? AND cabinet_id=? AND module_no=?'
  ).get(projectId, cabinetId, moduleNo);
  if (dup) {
    return sendJson(res, 409, { error: `柜子 ${cabinet.name} 的模块号 ${moduleNo} 已存在，请使用其他模块号` });
  }

  const mid = db.prepare(`
    INSERT INTO modules (project_id, cabinet_id, module_no, module_type_id, module_model_id, note, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(projectId, cabinetId, moduleNo, typeId, modelId, str(b.note, 200), now, user?.id ?? null)
    .lastInsertRowid;

  // 按型号总通道数生成点位行，PLC 点位自动填充
  const chCount = model.channel_count;
  const base = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) m FROM points WHERE module_id = ?'
  ).get(mid).m;
  const ins = db.prepare(`
    INSERT INTO points (project_id, module_id, part, point_name, signal_type_id, plc_point, sort_order, updated_at)
    VALUES (?,?,'','',NULL,?,?,?)
  `);
  const nowStr = new Date().toISOString();
  for (let i = 0; i < chCount; i++) {
    ins.run(projectId, mid, computePlcPoint(cabinet.name, moduleNo, mtype.plc_prefix, i), base + 1 + i, nowStr);
  }

  sendJson(res, 200, { id: Number(mid), created: chCount, module: moduleWithMeta(Number(mid)) });
});

route('PUT', '/api/modules/:id', async ({ req, res, params, user }) => {
  const id = intOrNull(params.id);
  const cur = moduleWithMeta(id);
  if (!cur) return sendJson(res, 404, { error: '模块不存在' });
  if (!canManageModule(user, cur)) {
    return sendJson(res, 403, { error: '只能修改自己创建的模块' });
  }
  const b = await readBody(req);
  const note = b.note === undefined ? cur.note : str(b.note, 200);
  db.prepare('UPDATE modules SET note = ? WHERE id = ?').run(note, id);
  sendJson(res, 200, { ok: true });
});

route('DELETE', '/api/modules/:id', async ({ res, params, user }) => {
  const id = intOrNull(params.id);
  const cur = moduleWithMeta(id);
  if (!cur) return sendJson(res, 404, { error: '模块不存在' });
  // 访客和管理员可删任意模块；普通账号保留归属权限。
  if (!canManageModule(user, cur)) {
    return sendJson(res, 403, { error: '只能删除自己创建的模块，其他模块请联系管理员' });
  }
  const pts = db.prepare('SELECT COUNT(*) c FROM points WHERE module_id = ?').get(id).c;
  db.prepare('DELETE FROM modules WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true, deletedPoints: pts });
});

/* ============================ 点位表 ============================ */

route('PUT', '/api/modules/:id/points', async ({ req, res, params, user }) => {
  const moduleId = intOrNull(params.id);
  const module = moduleWithMeta(moduleId);
  if (!module) return sendJson(res, 404, { error: '模块不存在' });
  const body = await readBody(req);
  if (!Array.isArray(body.points) || body.points.length > module.channel_count) {
    return sendJson(res, 400, { error: '模块点位数据格式无效' });
  }

  const existing = db.prepare(`SELECT id, part, point_name, signal_type_id FROM points
    WHERE module_id=? ORDER BY sort_order, id`).all(moduleId);
  const existingById = new Map(existing.map((point) => [point.id, point]));
  const seen = new Set();
  const rows = [];
  for (const [index, row] of body.points.entries()) {
    const id = intOrNull(row?.id);
    const current = existingById.get(id);
    if (!current || seen.has(id)) return sendJson(res, 400, { error: '点位行无效或重复' });
    seen.add(id);
    const part = str(row.part, 32).trim();
    const pointName = str(row.point_name, 64).toUpperCase();
    const signalTypeId = intOrNull(row.signal_type_id);
    if (signalTypeId && !signalTypeById(signalTypeId)) {
      return sendJson(res, 400, { error: '信号类型不存在' });
    }
    const changedSelection = part !== current.part || signalTypeId !== current.signal_type_id;
    if (signalTypeId && changedSelection
      && (!signalMatchesPart(signalTypeId, part) || !signalMatchesModule(signalTypeId, module))) {
      return sendJson(res, 400, { error: '信号类型与设备部位或模块类型不匹配' });
    }
    rows.push({ id, part, pointName, signalTypeId, sortOrder: index });
  }

  const removed = existing.filter((point) => !seen.has(point.id));
  if (removed.length && !canManageModule(user, module)) {
    return sendJson(res, 403, { error: '无权删除此模块内的点位' });
  }

  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare(`UPDATE points SET part=?, point_name=?, signal_type_id=?, sort_order=?, updated_at=?
      WHERE id=? AND module_id=?`);
    for (const row of rows) update.run(row.part, row.pointName, row.signalTypeId, row.sortOrder, now, row.id, moduleId);
    for (const point of removed) db.prepare('DELETE FROM points WHERE id=? AND module_id=?').run(point.id, moduleId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  sendJson(res, 200, { ok: true, items: listPoints({ moduleId }) });
});

route('GET', '/api/points', async ({ res, url }) => {
  const pid = intOrNull(url.searchParams.get('project_id'));
  const mid = intOrNull(url.searchParams.get('module_id'));
  sendJson(res, 200, { items: listPoints({ projectId: pid, moduleId: mid }) });
}, { public: true });

route('POST', '/api/points', async ({ req, res }) => {
  const b = await readBody(req);
  const moduleId = intOrNull(b.module_id);
  if (b.module_id != null && !moduleId) return sendJson(res, 400, { error: '模块编号无效' });
  const module = moduleId ? moduleWithMeta(moduleId) : null;
  if (moduleId && !module) return sendJson(res, 404, { error: '模块不存在' });
  if (module && b.project_id != null && intOrNull(b.project_id) !== module.project_id) {
    return sendJson(res, 400, { error: '模块与项目不匹配' });
  }
  const projectId = module ? module.project_id : intOrNull(b.project_id);
  if (!projectId || !db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return sendJson(res, 400, { error: '项目不存在' });
  }
  const sigId = intOrNull(b.signal_type_id);
  if (sigId && !signalTypeById(sigId)) return sendJson(res, 400, { error: '信号类型不存在' });
  if (sigId && !signalMatchesPart(sigId, str(b.part, 32))) return sendJson(res, 400, { error: '信号类型不属于所选设备部位' });
  if (sigId && !signalMatchesModule(sigId, module)) return sendJson(res, 400, { error: `该模块只能选择名称以 ${module.module_type_name} 结尾的信号类型` });
  const now = new Date().toISOString();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM points WHERE project_id = ? AND module_id IS ?')
    .get(projectId, moduleId).m;
  const plc = b.plc_point === undefined && module
    ? computePlcPoint(module.cabinet_name, module.module_no, module.plc_prefix, max + 1)
    : str(b.plc_point, 64);
  const info = db.prepare(`
    INSERT INTO points (project_id, module_id, part, point_name, signal_type_id, plc_point, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, moduleId, str(b.part, 32), str(b.point_name, 64).toUpperCase(),
    sigId, plc, max + 1, now);
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
});

route('PATCH', '/api/points/:id', async ({ req, res, params }) => {
  const id = intOrNull(params.id);
  const cur = db.prepare('SELECT * FROM points WHERE id = ?').get(id);
  if (!cur) return sendJson(res, 404, { error: '点位不存在' });
  const b = await readBody(req);
  const part = b.part === undefined ? cur.part : str(b.part, 32);
  const pointName = b.point_name === undefined ? cur.point_name : str(b.point_name, 64).toUpperCase();
  let sigId = b.signal_type_id === undefined ? cur.signal_type_id : intOrNull(b.signal_type_id);
  const plc = b.plc_point === undefined ? cur.plc_point : str(b.plc_point, 64);
  if (sigId && !signalTypeById(sigId)) return sendJson(res, 400, { error: '信号类型不存在' });
  if (sigId && (b.part !== undefined || b.signal_type_id !== undefined) && !signalMatchesPart(sigId, part)) {
    if (b.signal_type_id !== undefined) return sendJson(res, 400, { error: '信号类型不属于所选设备部位' });
    sigId = null;
  }
  const module = cur.module_id ? moduleWithMeta(cur.module_id) : null;
  if (sigId && (b.part !== undefined || b.signal_type_id !== undefined) && !signalMatchesModule(sigId, module)) {
    if (b.signal_type_id !== undefined) return sendJson(res, 400, { error: `该模块只能选择名称以 ${module.module_type_name} 结尾的信号类型` });
    sigId = null;
  }
  db.prepare(`
    UPDATE points SET part=?, point_name=?, signal_type_id=?, plc_point=?, updated_at=? WHERE id=?
  `).run(part, pointName, sigId, plc, new Date().toISOString(), id);
  // 返回该行推导结果，前端即时回显
  const [row] = listPoints({ moduleId: cur.module_id }).filter((r) => r.id === id);
  sendJson(res, 200, { ok: true, row });
});

route('POST', '/api/points/:id/move', async ({ req, res, params }) => {
  const id = intOrNull(params.id);
  const b = await readBody(req);
  const dir = str(b.direction, 10);
  const cur = db.prepare('SELECT * FROM points WHERE id = ?').get(id);
  if (!cur) return sendJson(res, 404, { error: '点位不存在' });
  const sibs = db.prepare(
    'SELECT id, sort_order FROM points WHERE project_id = ? AND module_id IS ? ORDER BY sort_order, id'
  ).all(cur.project_id, cur.module_id);
  const idx = sibs.findIndex((s) => s.id === id);
  const target = dir === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= sibs.length) return sendJson(res, 200, { ok: true });
  const a = sibs[idx], c = sibs[target];
  db.prepare('UPDATE points SET sort_order = ? WHERE id = ?').run(c.sort_order, a.id);
  db.prepare('UPDATE points SET sort_order = ? WHERE id = ?').run(a.sort_order, c.id);
  sendJson(res, 200, { ok: true });
});

route('DELETE', '/api/points/:id', async ({ res, params, user }) => {
  const id = intOrNull(params.id);
  const point = db.prepare('SELECT * FROM points WHERE id = ?').get(id);
  if (!point) return sendJson(res, 404, { error: '点位不存在' });
  if (point.module_id && !canManageModule(user, moduleWithMeta(point.module_id))) {
    return sendJson(res, 403, { error: '只能删除访客模块或自己创建的模块内的点位' });
  }
  db.prepare('DELETE FROM points WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/points/bulk-part', async ({ req, res }) => {
  const b = await readBody(req);
  const moduleId = intOrNull(b.module_id);
  const part = str(b.part, 32);
  if (!part) return sendJson(res, 400, { error: '设备部位不能为空' });
  const now = new Date().toISOString();
  if (moduleId) {
    db.prepare(`UPDATE points SET part=?, updated_at=?, signal_type_id=CASE WHEN signal_type_id IN
      (SELECT st.id FROM signal_types st JOIN parts p ON p.id=st.part_id WHERE p.param=? AND p.active=1 AND st.active=1)
      THEN signal_type_id ELSE NULL END WHERE module_id=?`).run(part, now, part, moduleId);
  } else {
    const pid = intOrNull(b.project_id);
    if (!pid) return sendJson(res, 400, { error: '缺少项目' });
    db.prepare(`UPDATE points SET part=?, updated_at=?, signal_type_id=CASE WHEN signal_type_id IN
      (SELECT st.id FROM signal_types st JOIN parts p ON p.id=st.part_id WHERE p.param=? AND p.active=1 AND st.active=1)
      THEN signal_type_id ELSE NULL END WHERE project_id=? AND module_id IS NULL`)
      .run(part, now, part, pid);
  }
  sendJson(res, 200, { ok: true });
});

/* ============================ 用户管理（管理员） ============================ */
route('GET', '/api/users', async ({ res }) => {
  const rows = db.prepare(
    'SELECT id, username, role, disabled, must_change_pwd, created_at FROM users ORDER BY id'
  ).all();
  sendJson(res, 200, {
    items: rows.map((r) => ({ ...r, disabled: !!r.disabled, must_change_pwd: !!r.must_change_pwd })),
  });
}, { admin: true });

route('POST', '/api/users', async ({ req, res }) => {
  const b = await readBody(req);
  const username = str(b.username, 64).trim();
  const password = str(b.password, 200);
  const role = b.role === 'admin' ? 'admin' : 'user';
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return sendJson(res, 400, { error: '用户名需为 3–32 位字母、数字、下划线、点或短横线' });
  }
  if (password.length < 6) return sendJson(res, 400, { error: '密码至少 6 位' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return sendJson(res, 409, { error: '用户名已存在' });
  }
  const { salt, hash } = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, salt, role, must_change_pwd, disabled, created_at) VALUES (?,?,?,?,1,0,?)'
  ).run(username, hash, salt, role, new Date().toISOString());
  sendJson(res, 200, { id: Number(info.lastInsertRowid) });
}, { admin: true });

route('PUT', '/api/users/:id', async ({ req, res, params, user }) => {
  const id = intOrNull(params.id);
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) return sendJson(res, 404, { error: '用户不存在' });
  const b = await readBody(req);
  const role = b.role === undefined ? cur.role : (b.role === 'admin' ? 'admin' : 'user');
  const disabled = b.disabled === undefined ? cur.disabled : (b.disabled ? 1 : 0);
  if (id === user.id && (role !== 'admin' || disabled)) {
    return sendJson(res, 400, { error: '不能取消自己的管理员权限或停用自己' });
  }
  db.prepare('UPDATE users SET role=?, disabled=? WHERE id=?').run(role, disabled, id);
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  if (b.password) {
    if (str(b.password, 200).length < 6) return sendJson(res, 400, { error: '密码至少 6 位' });
    const { salt, hash } = hashPassword(str(b.password, 200));
    db.prepare('UPDATE users SET password_hash=?, salt=?, must_change_pwd=1 WHERE id=?').run(hash, salt, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  sendJson(res, 200, { ok: true });
}, { admin: true });

route('DELETE', '/api/users/:id', async ({ res, params, user }) => {
  const id = intOrNull(params.id);
  if (id === user.id) return sendJson(res, 400, { error: '不能删除自己' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
}, { admin: true });

/* ============================ 汇总 / 导出 ============================ */

route('GET', '/api/summary', async ({ res, url }) => {
  const pid = intOrNull(url.searchParams.get('project_id'));
  const where = pid ? 'WHERE project_id = ?' : '';
  const arg = pid ? [pid] : [];
  const projects = db.prepare(`
    SELECT p.id, p.name,
      (SELECT COUNT(*) FROM modules m WHERE m.project_id = p.id) AS module_count,
      (SELECT COUNT(*) FROM points pt WHERE pt.project_id = p.id) AS point_count,
      (SELECT COUNT(*) FROM points pt WHERE pt.project_id = p.id AND pt.signal_type_id IS NULL) AS unassigned_count
    FROM projects p ORDER BY p.sort_order, p.id
  `).all();
  const byType = db.prepare(`
    SELECT st.name, COUNT(pt.id) AS c
    FROM signal_types st
    LEFT JOIN points pt ON pt.signal_type_id = st.id ${pid ? 'AND pt.project_id = ' + Number(pid) : ''}
    GROUP BY st.id ORDER BY c DESC, st.sort_order
  `).all();
  const reserved = db.prepare(
    `SELECT COUNT(*) c FROM points pt WHERE pt.project_id = ${pid ? Number(pid) : '(SELECT id FROM projects LIMIT 1)'} AND pt.signal_type_id IN (SELECT id FROM signal_types WHERE no_sensor = 1)`
  ).get().c;
  sendJson(res, 200, {
    projects, byType: byType.filter((x) => x.c > 0),
    modules: db.prepare(`SELECT COUNT(*) c FROM modules ${where}`).get(...arg).c,
    points: db.prepare(`SELECT COUNT(*) c FROM points ${where}`).get(...arg).c,
    reserved: pid ? reserved : 0,
  });
}, { public: true });

route('GET', '/api/export', async ({ res, url }) => {
  const pid = intOrNull(url.searchParams.get('project_id'));
  const mid = intOrNull(url.searchParams.get('module_id'));
  const cid = intOrNull(url.searchParams.get('cabinet_id'));
  for (const [key, id] of [['project_id', pid], ['module_id', mid], ['cabinet_id', cid]]) {
    if (url.searchParams.has(key) && (!id || id < 1)) return sendJson(res, 400, { error: '导出范围参数无效' });
  }
  if (cid && !pid) return sendJson(res, 400, { error: '导出控制柜时必须指定项目' });
  const project = pid ? db.prepare('SELECT name FROM projects WHERE id = ?').get(pid) : null;
  const cabinet = cid ? db.prepare('SELECT name FROM cabinets WHERE id = ?').get(cid) : null;
  if (pid && !project) return sendJson(res, 404, { error: '项目不存在' });
  if (cid && !cabinet) return sendJson(res, 404, { error: '控制柜不存在' });
  const module = mid ? moduleWithMeta(mid) : null;
  if (mid && !module) return sendJson(res, 404, { error: '模块不存在' });
  if (module && ((pid && module.project_id !== pid) || (cid && module.cabinet_id !== cid))) {
    return sendJson(res, 400, { error: '模块与导出范围不匹配' });
  }
  const mods = mid ? [module] : listModules(pid).filter(m => !cid || m.cabinet_id === cid);
  const moduleMap = new Map(mods.map(m => [m.id, m]));
  const rows = listPoints({ projectId: pid, moduleId: mid }).filter(r => moduleMap.has(r.module_id));
  if (!mid && (pid || cid)) {
    const workbook = buildModuleWorkbook(mods, rows);
    const name = cabinet ? `${project.name}_${cabinet.name}` : project.name;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="points_${Date.now()}.xlsx"; filename*=UTF-8''${encodeURIComponent(name + '_点位配置.xlsx')}`,
      'Cache-Control': 'no-store',
    });
    return res.end(workbook);
  }
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  if (mods.length) {
    lines.push(esc('模块清单'));
    lines.push(['项目', '柜子号', '模块号', '模块类型', '模块型号', '总通道数', '点位数量', '备注']
      .map(esc).join(','));
    for (const m of mods) {
      lines.push([m.project_name, m.cabinet_name, m.module_no, m.module_type_name,
        m.module_model_name, m.channel_count, m.point_count ?? '', m.note ?? ''].map(esc).join(','));
    }
    lines.push('');
  }
  lines.push(esc('现场设备点位表'));
  lines.push(['项目', '柜子号', '模块号', '模块类型', '模块型号', '序号', '设备部位', '设备点位', '信号类型', '传感器类型', '编号', 'PLC点位表达式']
    .map(esc).join(','));
  const sequences = new Map();
  for (const r of rows) {
    const m = moduleMap.get(r.module_id);
    const seq = (sequences.get(r.module_id) || 0) + (r.part ? 1 : 0);
    sequences.set(r.module_id, seq);
    lines.push([m.project_name, m.cabinet_name, m.module_no, m.module_type_name, m.module_model_name,
      r.part ? seq : '', r.part, r.point_name, r.signal_name, r.sensor_type, r.code, r.plc_expression]
      .map(esc).join(','));
  }
  const name = module ? `${module.project_name}_${module.cabinet_name}_模块${module.module_no}` : cabinet ? `${project.name}_${cabinet.name}` : project ? project.name : '全部项目';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="points_${Date.now()}.csv"; filename*=UTF-8''${encodeURIComponent(name + '_点位配置.csv')}`,
    'Cache-Control': 'no-store',
  });
  res.end('﻿' + lines.join('\r\n'));
}, { public: true });

function buildModuleWorkbook(modules, pointRows) {
  const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const colName = number => {
    let name = '';
    while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26); }
    return name;
  };
  const worksheet = type => {
    const selected = modules.filter(m => (type === 'DI'
      ? ['DI', 'AI'] : ['DO', 'AO']).includes(String(m.module_type_name).trim().toUpperCase()));
    const rows = [];
    const headings = ['项目', '柜子号', '模块号', '模块类型', '模块型号', '序号', '设备部位', '设备点位', '信号类型', '传感器类型', '编号', 'PLC点位表达式'];
    for (const [moduleIndex, m] of selected.entries()) {
      if (moduleIndex === 0) {
        rows.push([m.project_name, m.cabinet_name, m.module_no, m.module_type_name, m.module_model_name,
          `通道数：${m.channel_count}`, `备注：${m.note || ''}`]);
        rows.push(headings);
      } else {
        rows.push([]);
      }
      const points = pointRows.filter(r => r.module_id === m.id);
      let sequence = 0;
      for (const r of points) {
        if (r.part) sequence++;
        rows.push([m.project_name, m.cabinet_name, m.module_no, m.module_type_name, m.module_model_name,
          r.part ? sequence : '', r.part, r.point_name, r.signal_name, r.sensor_type, r.code, r.plc_expression]);
      }
    }
    if (!selected.length) rows.push([`暂无 ${type} 模块`]);
    const columnWidths = Array.from({ length: 12 }, (_, column) => {
      const widest = rows.reduce((max, row) => {
        const text = String(row[column] ?? '');
        const displayWidth = Math.max(...text.split(/\r?\n/).map(line => Array.from(line).reduce((width, char) =>
          width + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0)), 0);
        return Math.max(max, displayWidth);
      }, 0);
      return Math.min(255, Math.max(8, widest + 2));
    }).map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" bestFit="1" customWidth="1"/>`).join('');
    const xmlRows = rows.map((values, index) => {
      const cells = values.map((value, column) => {
        if (value === '' || value == null) return '';
        const ref = `${colName(column + 1)}${index + 1}`;
        if (typeof value === 'number' && Number.isFinite(value))
          return `<c r="${ref}"><v>${value}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }).join('');
      return `<row r="${index + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="18"/><cols>${columnWidths}</cols><sheetData>${xmlRows}</sheetData></worksheet>`;
  };
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DI模块" sheetId="1" r:id="rId1"/><sheet name="DO模块" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', worksheet('DI')],
    ['xl/worksheets/sheet2.xml', worksheet('DO')],
  ];
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = buffer => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, 'utf8'), data = Buffer.from(content, 'utf8'), checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.replace(/\?.*$/, '');
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA 回退
      const idx = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isHTML = ext === '.html';
    const isSW = path.basename(filePath) === 'sw.js';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHTML || isSW ? 'no-cache' : 'public, max-age=300',
      'Service-Worker-Allowed': '/',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* 主处理器                                                            */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    serveStatic(req, res, pathname);
    return;
  }

  const hit = matchRoute(req.method, pathname);
  if (!hit) return sendJson(res, 404, { error: '接口不存在' });

  const ip = req.socket.remoteAddress || 'unknown';
  const user = getSessionUser(req);

  if (!hit.r.public && !user) return sendJson(res, 401, { error: '请先登录' });
  if (hit.r.admin && (!user || user.role !== 'admin')) {
    return sendJson(res, 403, { error: '需要管理员权限' });
  }

  try {
    await hit.r.handler({ req, res, user, params: hit.params, url, ip });
  } catch (err) {
    const msg = err && err.message;
    if (msg === 'PAYLOAD_TOO_LARGE') return sendJson(res, 413, { error: '数据过大' });
    if (msg === 'INVALID_JSON') return sendJson(res, 400, { error: '请求格式错误' });
    console.error('[API ERROR]', pathname, err);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
  }
});

// 兜底：任何未捕获异常都不应终止进程
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED]', err);
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 30 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`现场设备点位表系统已启动 → http://localhost:${PORT}`);
});

module.exports = server;
