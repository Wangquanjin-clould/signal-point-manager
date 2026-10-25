/* ==========================================================================
   现场设备点位表 —— 前端应用
   编号与传感器类型均由服务端配置驱动推导（复刻 Excel 公式）
   ========================================================================== */
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  user: null,
  signals: [],
  config: null,
  tree: [],
  points: [],
  pointsDirty: false,
  modules: [],
  currentProjectId: null,
  currentCabinetId: null,
  currentModuleId: null,
  search: '',
  treeFilter: '',
  treeExpansion: {},
};

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */
async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toastWrap').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* 登录                                                              */
/* ------------------------------------------------------------------ */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#loginMsg');
  msg.textContent = ''; msg.className = 'form-msg';
  const btn = $('#loginForm button[type=submit]');
  btn.disabled = true;
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('#loginUser').value.trim(), password: $('#loginPwd').value },
    });
    state.user = r.user;
    closeLogin();
    await enterApp();
    if (state.user.role === 'admin') {
      showPage('options');
      await loadOptions();
    } else {
      toast('基础配置需要管理员权限，请使用管理员账号', 'warn');
    }
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function closeLogin() {
  $('#loginView').hidden = true;
  $('#loginPwd').value = '';
}

async function requestConfigLogin() {
  closeDrawers();
  $('#loginMsg').textContent = '';
  $('#loginView').hidden = false;
  await checkRegister();
  $('#loginUser').focus();
}

$('#cancelLogin').addEventListener('click', closeLogin);
$('#loginView').addEventListener('click', (e) => {
  if (e.target === $('#loginView')) closeLogin();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#loginView').hidden && $('#registerModal').hidden) closeLogin();
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ------------------------------------------------------------------ */
/* 自助注册                                                            */
/* ------------------------------------------------------------------ */
let registerEnabled = false;

async function checkRegister() {
  try {
    const r = await api('/api/auth/register-status');
    registerEnabled = !!r.enabled;
  } catch { registerEnabled = false; }
  $('#goRegister').hidden = !registerEnabled;
}

$('#goRegister').addEventListener('click', () => {
  $('#registerMsg').textContent = '';
  $('#registerMsg').className = 'form-msg';
  $('#regUser').value = ''; $('#regPwd').value = ''; $('#regPwd2').value = '';
  $('#registerModal').hidden = false;
  setTimeout(() => $('#regUser').focus(), 80);
});

$('#registerConfirm').addEventListener('click', async () => {
  const msg = $('#registerMsg');
  msg.textContent = ''; msg.className = 'form-msg';
  const btn = $('#registerConfirm');
  btn.disabled = true;
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: $('#regUser').value.trim(),
        password: $('#regPwd').value,
        confirmPassword: $('#regPwd2').value,
      },
    });
    $('#registerModal').hidden = true;
    toast('注册成功，请登录', 'ok');
    $('#loginUser').value = $('#regUser').value.trim();
    $('#loginPwd').value = '';
    $('#loginPwd').focus();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$$('#registerModal [data-close]').forEach((b) => {
  b.addEventListener('click', () => { $('#registerModal').hidden = true; });
});
$('#registerModal').addEventListener('click', (e) => {
  if (e.target === $('#registerModal')) $('#registerModal').hidden = true;
});

/* ------------------------------------------------------------------ */
/* 页面切换                                                            */
/* ------------------------------------------------------------------ */
function showPage(name) {
  if (['options', 'signals', 'users'].includes(name) && state.user?.role !== 'admin') {
    if (name === 'options') requestConfigLogin();
    else toast('需要管理员权限，请先通过基础配置登录', 'warn');
    return false;
  }
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  closeDrawers();
  window.scrollTo({ top: 0 });
  return true;
}
$$('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const page = btn.dataset.page;
    if (!confirmDiscardPointDraft()) return;
    if (page === 'options') {
      try {
        const r = await api('/api/auth/me');
        state.user = r.user;
        updateUserUI();
      } catch (err) {
        toast('无法读取登录状态：' + err.message, 'warn');
        return;
      }
    }
    // 点位表必须先选中模块，避免再次铺开全部记录
    if (page === 'points' && !state.currentModuleId) {
      toast('请先从左侧项目结构中选择模块', 'warn');
      return;
    }
    if (!showPage(page)) return;
    if (page === 'overview') { loadTree().then(renderOverview); }
    if (page === 'points') refreshData();
    if (page === 'signals') loadSignals();
    if (page === 'options') loadOptions();
    if (page === 'users') loadUsers();
  });
});

/** 移动端：页面导航与项目结构使用独立入口，一次只展开一个抽屉。 */
function closeDrawers(restoreFocus = false) {
  const trigger = document.body.classList.contains('nav-open') ? $('#navToggle')
    : document.body.classList.contains('tree-open') ? $('#treeToggle') : null;
  document.body.classList.remove('nav-open', 'tree-open');
  $('#navToggle').setAttribute('aria-expanded', 'false');
  $('#treeToggle').setAttribute('aria-expanded', 'false');
  if (restoreFocus && trigger) trigger.focus();
}

function toggleTreeDrawer(force) {
  const open = force !== undefined ? force : !document.body.classList.contains('tree-open');
  closeDrawers();
  document.body.classList.toggle('tree-open', open);
  $('#treeToggle').setAttribute('aria-expanded', String(open));
}

$('#navToggle').addEventListener('click', () => {
  const open = !document.body.classList.contains('nav-open');
  closeDrawers();
  document.body.classList.toggle('nav-open', open);
  $('#navToggle').setAttribute('aria-expanded', String(open));
});
$('#treeToggle').addEventListener('click', () => toggleTreeDrawer());
$('#navBackdrop').addEventListener('click', () => closeDrawers(true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawers(true);
});
window.matchMedia('(max-width: 820px)').addEventListener('change', () => closeDrawers());

/* 通用弹窗 */
function openFormModal({ title, fields, confirmText = '确定', onConfirm }) {
  return new Promise((resolve) => {
    $('#formModalTitle').textContent = title;
    $('#formConfirm').textContent = confirmText;
    const msg = $('#formMsg');
    msg.textContent = ''; msg.className = 'form-msg';

    const grid = $('#formGrid');
    grid.innerHTML = fields.map((f) => `
      <label class="field ${f.full ? 'field-full' : ''}">
        <span>${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</span>
        ${f.type === 'select'
          ? `<select data-f="${f.key}">${f.options.map((o) =>
              `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
          : f.type === 'switch'
            ? `<span class="switch"><input type="checkbox" data-f="${f.key}"${f.checked ? ' checked' : ''}><span></span></span>`
            : `<input type="${f.type || 'text'}" data-f="${f.key}" value="${esc(f.value ?? '')}"
                 placeholder="${esc(f.placeholder || '')}" maxlength="${f.maxlength || 200}">`}
      </label>`).join('');

    const modal = $('#formModal');
    modal.hidden = false;

    const readValues = () => {
      const out = {};
      fields.forEach((f) => {
        const el = grid.querySelector(`[data-f="${f.key}"]`);
        out[f.key] = f.type === 'switch' ? el.checked : el.value;
      });
      return out;
    };

    const close = (val) => {
      modal.hidden = true;
      // 必须复位：否则一次成功提交后按钮永久置灰，后续再次打开弹窗点不动
      $('#formConfirm').disabled = false;
      $('#formConfirm').removeEventListener('click', onOk);
      $('#formModal').removeEventListener('click', maskClick);
      resolve(val);
    };
    const maskClick = (e) => { if (e.target === modal) close(null); };

    async function onOk() {
      const btn = $('#formConfirm');
      btn.disabled = true;
      try {
        const result = await onConfirm(readValues());
        if (result === false) { btn.disabled = false; return; }
        msg.textContent = ''; msg.className = 'form-msg ok';
        close(result ?? true);
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-msg';
        btn.disabled = false;
      }
    }

    // 每次打开都恢复可用状态
    $('#formConfirm').disabled = false;
    $('#formConfirm').addEventListener('click', onOk);
    $('#formModal').addEventListener('click', maskClick);
    $$('#formModal [data-close]').forEach((b) => {
      b.onclick = () => close(null);
    });
    const first = grid.querySelector('input,select');
    if (first) setTimeout(() => first.focus(), 60);
  });
}

/* ------------------------------------------------------------------ */
/* 进入应用                                                            */
/* ------------------------------------------------------------------ */
function updateUserUI() {
  const u = state.user;
  $('#userName').textContent = u?.username || '访客';
  $('#userAvatar').textContent = u ? u.username.slice(0, 1) : '访';
  const roleEl = $('#userRole');
  roleEl.textContent = u?.role === 'admin' ? '管理员' : u ? '普通用户' : '免登录使用';
  roleEl.classList.toggle('is-admin', u?.role === 'admin');
  $('#brandSub').textContent = u?.role === 'admin'
    ? '管理员 · 可配置信号类型' : '信号线编号自动生成';
  $$('.admin-only').forEach((el) => { el.hidden = u?.role !== 'admin'; });
  $('#logoutBtn').hidden = !u;
  $('#pwdNavBtn').hidden = !u;
}

async function enterApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  updateUserUI();
  const u = state.user;

  await Promise.all([loadConfig(), loadSignals(), loadTree()]);
  if (u?.role === 'admin') renderSignalTable();
  fillPartSelect();
  // 默认停在项目总览，不直接铺开所有点位
  state.currentModuleId = null;
  state.currentCabinetId = null;
  renderOverview();
  showPage('overview');

  if (u?.mustChangePwd) {
    toast('首次登录请先修改密码', 'warn');
    openFormModal({
      title: '修改密码',
      confirmText: '保存',
      fields: [
        { key: 'oldPassword', label: '原密码', type: 'password', required: true, full: true },
        { key: 'newPassword', label: '新密码（至少 6 位）', type: 'password', required: true, full: true },
      ],
      onConfirm: async (v) => {
        await api('/api/auth/password', { method: 'POST', body: v });
        state.user.mustChangePwd = false;
        toast('密码已更新', 'ok');
      },
    });
  }
}

/* ------------------------------------------------------------------ */
/* 配置 & 信号类型                                                     */
/* ------------------------------------------------------------------ */
/* ================================================================== */
/* 项目树                                                             */
/* ================================================================== */
async function loadTree() {
  const r = await api('/api/tree');
  state.tree = r.projects;
  renderTree();
}

function matchesFilter(text) {
  if (!state.treeFilter) return true;
  return String(text).toLowerCase().includes(state.treeFilter);
}

/** 递归判断子树是否有命中项 */
function subtreeHasMatch(node) {
  if (matchesFilter(node.name)) return true;
  return (node.cabinets || []).some((c) =>
    matchesFilter(c.name) ||
    (c.modules || []).some((m) => matchesFilter(`${m.module_no} ${m.module_type_name} ${m.module_model_name}`)));
}

function renderTree() {
  const body = $('#treeBody');
  if (!state.tree.length) {
    body.innerHTML = '<div class="tree-empty">暂无项目<br>请联系管理员在「基础配置」中新增</div>';
    return;
  }
  const filterOn = !!state.treeFilter;
  let html = '';
  state.tree.forEach((p) => {
    const hit = subtreeHasMatch(p);
    if (filterOn && !hit) return;
    const pOpen = state.treeExpansion[`project:${p.id}`] ?? (filterOn || state.currentProjectId === p.id);
    html += `
      <div class="tree-node project ${state.currentProjectId === p.id ? 'active' : ''} ${pOpen ? 'open' : ''}" data-node="project" data-id="${p.id}">
        <button class="tree-expander" type="button" aria-label="${pOpen ? '折叠' : '展开'}项目 ${esc(p.name)}" aria-expanded="${pOpen}"><svg class="caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <svg class="t-icon" viewBox="0 0 24 24" width="15" height="15"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>
        <span class="t-label" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="t-count">${p.module_count}</span>
      </div>
      <div class="tree-children ${pOpen ? 'open' : ''}" data-parent="project" data-id="${p.id}">`;
    if (!p.cabinets.length) {
      html += '<div class="tree-empty" style="padding:8px 4px;font-size:11.5px">暂无控制柜</div>';
    }
    p.cabinets.forEach((c) => {
      const cHit = matchesFilter(c.name) ||
        (c.modules || []).some((m) => matchesFilter(`${m.module_no} ${m.module_type_name} ${m.module_model_name}`));
      if (filterOn && !cHit) return;
      const cOpen = state.treeExpansion[`cabinet:${p.id}:${c.id}`] ?? (filterOn || state.currentProjectId === p.id);
      html += `
        <div class="cabinet-tree-item" data-project="${p.id}" data-id="${c.id}" draggable="${!filterOn}">
        <div class="tree-node cabinet ${cOpen ? 'open' : ''} ${state.currentProjectId === p.id && state.currentCabinetId === c.id ? 'active' : ''}" data-node="cabinet" data-id="${c.id}" data-project="${p.id}">
          <button class="tree-expander" type="button" aria-label="${cOpen ? '折叠' : '展开'}柜子 ${esc(c.name)}" aria-expanded="${cOpen}"><svg class="caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <svg class="t-icon" viewBox="0 0 24 24" width="15" height="15"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          <span class="t-label cabinet-drag-label" title="${esc(c.name)}（按住拖动排序）" tabindex="0">${esc(c.name)}</span>
          <span class="t-count">${c.module_count}</span>
        </div>
        <div class="tree-children ${cOpen ? 'open' : ''}" data-parent="cabinet" data-id="${c.id}">`;
      if (!c.modules.length) {
        html += '<div class="tree-empty" style="padding:8px 4px;font-size:11.5px">该柜暂无模块</div>';
      }
      c.modules.forEach((m) => {
        const done = m.unfilled_count === 0;
        html += `
          <div class="tree-node mod ${state.currentModuleId === m.id ? 'active' : ''} ${done ? 'done' : ''} ${m.mine ? 'mine' : ''}" data-node="module" data-id="${m.id}" data-project="${p.id}" title="${esc(`${m.module_no} · ${m.module_type_name} · ${m.module_model_name} · 创建者 ${m.created_by_name || '—'}`)}">
            <svg class="t-icon" viewBox="0 0 24 24" width="15" height="15"><rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.7" fill="none"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            <span class="t-label">${esc(m.module_no)}</span>
            <span class="t-sub">${esc(m.module_type_name)}</span>
            ${m.mine ? '<span class="t-mine" title="我创建的">我</span>' : ''}
            ${done ? '<span class="t-badge">完成</span>' : ''}
            <span class="t-count">${m.point_count}</span>
          </div>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
  });
  if (!html) html = '<div class="tree-empty">没有匹配的结果</div>';
  body.innerHTML = html;
}

$('#treeBody').addEventListener('click', (e) => {
  if (Date.now() < cabinetClickBlockedUntil) return;
  const node = e.target.closest('.tree-node');
  if (!node) return;
  const kind = node.dataset.node;
  const id = Number(node.dataset.id);
  const key = kind === 'project' ? `project:${id}` : `cabinet:${node.dataset.project}:${id}`;
  if (e.target.closest('.tree-expander')) {
    state.treeExpansion[key] = !node.classList.contains('open');
    renderTree();
    $(`[data-node="${kind}"][data-id="${id}"]${kind === 'cabinet' ? `[data-project="${node.dataset.project}"]` : ''} .tree-expander`)?.focus();
    return;
  }
  if (!confirmDiscardPointDraft()) return;

  if (kind === 'project') {
    selectProject(id);
    return;
  }

  if (kind === 'cabinet') {
    selectCabinet(Number(node.dataset.project), id);
    return;
  }

  if (kind === 'module') {
    state.currentProjectId = Number(node.dataset.project);
    state.currentModuleId = id;
    openModuleView();
  }
});

/* 柜子拖放：柜子与其模块作为一组移动，顺序只属于当前项目。 */
let cabinetDrag = null;
let cabinetHold = null;
let cabinetSaving = false;
let cabinetClickBlockedUntil = 0;
const treeBody = $('#treeBody');
function beginCabinetDrag(item, type) {
  if (cabinetSaving || state.treeFilter) return false;
  cabinetDrag = { item, type, parent: item.parentElement, projectId: Number(item.dataset.project),
    original: [...item.parentElement.children].filter(el => el.matches('.cabinet-tree-item')).map(el => Number(el.dataset.id)) };
  item.classList.add('is-dragging');
  return true;
}
function moveCabinetDrag(y) {
  if (!cabinetDrag) return;
  const siblings = [...cabinetDrag.parent.children].filter(el => el.matches('.cabinet-tree-item') && el !== cabinetDrag.item);
  const before = siblings.find(el => y < el.getBoundingClientRect().top + el.offsetHeight / 2);
  cabinetDrag.parent.insertBefore(cabinetDrag.item, before || null);
}
async function finishCabinetDrag(cancel = false) {
  clearTimeout(cabinetHold?.timer); cabinetHold = null;
  if (!cabinetDrag) return;
  const drag = cabinetDrag; cabinetDrag = null;
  cabinetClickBlockedUntil = Date.now() + 300;
  const ids = [...drag.parent.children].filter(el => el.matches('.cabinet-tree-item')).map(el => Number(el.dataset.id));
  if (cancel || ids.every((id, index) => id === drag.original[index])) { renderTree(); return; }
  cabinetSaving = true; treeBody.classList.add('is-saving');
  try {
    await api(`/api/projects/${drag.projectId}/cabinets/reorder`, { method: 'POST', body: { ids } });
    await loadTree(); renderOverview();
    toast('柜子顺序已保存', 'ok');
  } catch (err) {
    toast(err.message, 'err'); await loadTree().catch(() => renderTree());
  } finally { cabinetSaving = false; treeBody.classList.remove('is-saving'); }
}
treeBody.addEventListener('mousedown', e => {
  const item = e.target.closest('.cabinet-tree-item');
  if (item) item.draggable = !!e.target.closest('.cabinet-drag-label') && !state.treeFilter;
});
treeBody.addEventListener('dragstart', e => {
  const item = e.target.closest('.cabinet-tree-item');
  if (!item || !item.draggable || cabinetHold || !beginCabinetDrag(item, 'mouse')) { e.preventDefault(); return; }
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.dataset.id);
});
treeBody.addEventListener('dragover', e => {
  if (cabinetDrag?.type !== 'mouse' || !cabinetDrag.parent.contains(e.target)) return;
  e.preventDefault(); moveCabinetDrag(e.clientY);
});
treeBody.addEventListener('drop', e => {
  if (cabinetDrag?.type !== 'mouse' || !cabinetDrag.parent.contains(e.target)) return;
  e.preventDefault(); finishCabinetDrag();
});
treeBody.addEventListener('dragend', () => finishCabinetDrag(true));
treeBody.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { finishCabinetDrag(true); return; }
  if (!e.target.closest('.cabinet-drag-label') || cabinetSaving || state.treeFilter) return;
  const item = e.target.closest('.cabinet-tree-item');
  item.draggable = false;
  const touch = e.touches[0];
  cabinetHold = { x: touch.clientX, y: touch.clientY, timer: setTimeout(() => beginCabinetDrag(item, 'touch'), 350) };
}, { passive: true });
treeBody.addEventListener('touchmove', e => {
  const touch = e.touches[0]; if (!touch) return;
  if (cabinetDrag?.type === 'touch') {
    e.preventDefault();
    const bounds = treeBody.getBoundingClientRect();
    if (touch.clientY < bounds.top + 30) treeBody.scrollTop -= 12;
    if (touch.clientY > bounds.bottom - 30) treeBody.scrollTop += 12;
    moveCabinetDrag(touch.clientY);
  } else if (cabinetHold && Math.hypot(touch.clientX - cabinetHold.x, touch.clientY - cabinetHold.y) > 8) {
    clearTimeout(cabinetHold.timer); cabinetHold = null;
  }
}, { passive: false });
treeBody.addEventListener('touchend', () => finishCabinetDrag());
treeBody.addEventListener('touchcancel', () => finishCabinetDrag(true));
treeBody.addEventListener('contextmenu', e => { if (cabinetHold || cabinetDrag) e.preventDefault(); });
treeBody.addEventListener('keydown', e => { if (e.key === 'Escape') finishCabinetDrag(true); });

$('#treeFilter').addEventListener('input', (e) => {
  state.treeFilter = e.target.value.trim().toLowerCase();
  renderTree();
});

$('#treeRefresh').addEventListener('click', async () => {
  await loadTree();
  await refreshCurrent();
  toast('已刷新', 'ok');
});

/* ================================================================== */
/* 项目总览页                                                          */
/* ================================================================== */
function selectProject(id) {
  if (!confirmDiscardPointDraft()) return;
  if (id != null) state.treeExpansion[`project:${id}`] = true;
  state.currentProjectId = id;
  state.currentCabinetId = null;
  state.currentModuleId = null;
  renderTree();
  renderOverview();
  showPage('overview');
}

function expandSelectedCabinet(projectId, cabinetId) {
  for (const project of state.tree) {
    for (const cabinet of project.cabinets) {
      state.treeExpansion[`cabinet:${project.id}:${cabinet.id}`] = project.id === projectId && cabinet.id === cabinetId;
    }
  }
  state.treeExpansion[`project:${projectId}`] = true;
}

function selectCabinet(projectId, cabinetId) {
  if (!confirmDiscardPointDraft()) return;
  state.currentProjectId = projectId;
  state.currentCabinetId = cabinetId;
  state.currentModuleId = null;
  expandSelectedCabinet(projectId, cabinetId);
  renderTree();
  renderOverview();
  showPage('overview');
}

$('#overviewBackBtn').addEventListener('click', () => {
  if (state.currentCabinetId) selectProject(state.currentProjectId);
  else selectProject(null);
});

let cabinetChannelsRequest=0;
async function loadCabinetChannels(projectId,cabinetId,modules,request){
  try{
    const result=await api(`/api/points?project_id=${projectId}&cabinet_id=${cabinetId}`);
    if(request!==cabinetChannelsRequest)return;
    const moduleMap=new Map(modules.map((module,index)=>[module.id,{...module,index}]));
    const rows=result.items.filter(row=>moduleMap.has(row.module_id)).sort((a,b)=>moduleMap.get(a.module_id).index-moduleMap.get(b.module_id).index||a.sort_order-b.sort_order||a.id-b.id);
    let used=0,previous=null;
    $('#cabinetChannelsBody').innerHTML=rows.map(row=>{
      const module=moduleMap.get(row.module_id),configured=Boolean(String(row.part||'').trim()&&String(row.point_name||'').trim()&&row.signal_type_id);
      if(configured)used++;
      const start=previous!==null&&previous!==row.module_id;previous=row.module_id;
      const part=state.config?.parts.find(item=>item.param===row.part)?.name||row.part||'—';
      const channel=String(row.plc_point||'').match(/\.(\d+)$/)?.[1]??row.sort_order;
      return `<tr${start?' class="cabinet-channel-module-start"':''}><td>${esc(module.module_no)}</td><td>${esc(module.module_type_name)}</td><td>${esc(channel)}</td><td>${esc(part)}</td><td>${esc(row.point_name||'—')}</td><td>${esc(row.signal_name||'—')}</td><td>${esc(row.sensor_type||'—')}</td><td class="mono">${esc(row.code)}</td><td class="mono">${esc(row.plc_expression)}</td></tr>`;
    }).join('');
    $('#cabinetChannelsStatus').textContent=rows.length?`共 ${modules.length} 个模块，${rows.length} 条通道 · 已用 ${used} / 备用 ${rows.length-used}`:'该控制柜暂无通道信息';
  }catch(error){if(request===cabinetChannelsRequest)$('#cabinetChannelsStatus').textContent='通道信息加载失败，请刷新重试：'+error.message;}
}

function renderOverview() {
  const project = state.tree.find((p) => p.id === state.currentProjectId);
  const cabinet = project?.cabinets.find((c) => c.id === state.currentCabinetId);
  if (!project) state.currentProjectId = null;
  if (!cabinet) state.currentCabinetId = null;
  const channelRequest=++cabinetChannelsRequest;
  $('#cabinetChannels').hidden=!cabinet;
  $('#cabinetChannelsBody').innerHTML='';
  $('#cabinetChannelsStatus').textContent=cabinet?'正在加载通道信息…':'';
  const projects = project ? [project] : state.tree;
  const cabinets = cabinet ? [cabinet] : projects.flatMap((p) => p.cabinets);
  const mods = cabinets.flatMap((c) => c.modules.map((m) => ({ ...m, cabinet_name: c.name })));
  state.modules = mods;
  $('#overviewTitle').textContent = cabinet ? `${project.name} / ${cabinet.name}` : project ? project.name : '项目总览';
  $('#overviewDesc').textContent = cabinet ? '选择模块，编辑通道点位表' : project ? '选择控制柜，查看柜内模块总览' : '选择项目，查看项目中的控制柜总览';
  $('#overviewBackBtn').hidden = !project;
  $('#overviewExportBtn').hidden = !project;
  $('#overviewExportBtn').title = cabinet ? '导出本控制柜全部模块的 DI/DO 工作表' : '导出本项目全部控制柜模块的 DI/DO 工作表';
  $('#overviewBackBtn').textContent = cabinet ? '返回项目总览' : '返回项目列表';
  const totalPoints = mods.reduce((s, m) => s + m.point_count, 0);
  const totalUnfilled = mods.reduce((s, m) => s + m.unfilled_count, 0);
  const totalCh = mods.reduce((s, m) => s + m.channel_count, 0);
  const filled = totalPoints - totalUnfilled;
  const rate = totalPoints ? Math.round((filled / totalPoints) * 100) : 0;

  $('#overviewStats').innerHTML = `
    <div class="stat-card">
      <div class="s-label">模块总数</div>
      <div class="s-value">${mods.length}</div>
      <div class="s-hint">共 ${cabinets.length} 个控制柜</div>
    </div>
    <div class="stat-card">
      <div class="s-label">点位总数</div>
      <div class="s-value">${totalPoints}</div>
      <div class="s-hint">总通道 ${totalCh}</div>
    </div>
    <div class="stat-card">
      <div class="s-label">已配置</div>
      <div class="s-value" style="color:var(--green)">${filled}</div>
      <div class="s-hint">完成率 ${rate}%</div>
    </div>
    <div class="stat-card">
      <div class="s-label">Reserved</div>
      <div class="s-value" style="color:var(--amber)">${totalUnfilled}</div>
      <div class="s-hint">待填写或无传感器</div>
    </div>`;

  const wrap = $('#moduleCards');
  wrap.classList.toggle('module-list-mode', Boolean(cabinet));
  const entries = cabinet ? mods : project ? project.cabinets : projects;
  $('#overviewEmpty').hidden = entries.length > 0;
  $('#overviewEmpty p').textContent = cabinet ? '该柜子下还没有模块' : project ? '该项目下还没有柜子，可通过新增模块添加' : '暂无项目，请在基础配置中添加项目';
  if (!cabinet) {
    wrap.innerHTML = entries.map((entry) => {
      const items = project ? entry.modules : entry.cabinets.flatMap((c) => c.modules);
      const points = items.reduce((sum, m) => sum + m.point_count, 0);
      const unfilled = items.reduce((sum, m) => sum + m.unfilled_count, 0);
      const pct = points ? Math.round((points - unfilled) / points * 100) : 0;
      const diModules = items.filter(m => String(m.module_type_name).trim().toUpperCase() === 'DI');
      const doModules = items.filter(m => String(m.module_type_name).trim().toUpperCase() === 'DO');
      const configured = list => list.reduce((sum, m) => sum + Number(m.configured_point_count || 0), 0);
      const spare = list => list.reduce((sum, m) => sum + Math.max(0,
        Number(m.channel_count || 0) - Number(m.configured_point_count || 0)), 0);
      return `<div class="mod-card" ${project ? `data-cabinet-overview="${entry.id}" data-project="${project.id}"` : `data-project-overview="${entry.id}"`}>
        <div class="mod-card-top"><div class="mod-no">${project ? '控制柜 ' : ''}${esc(entry.name)}</div><span class="mod-badge ${points && !unfilled ? 'done' : ''}">${pct}% 已配置</span></div>
        <div class="mod-card-meta">
          ${project ? '' : `<div class="meta-row"><span class="k">控制柜</span><span class="v">${entry.cabinets.length} 个</span></div>`}
          ${project ? `<div class="meta-row"><span class="k">DI模块 / DO模块</span><span class="v">${diModules.length} 个 / ${doModules.length} 个</span></div>
          <div class="meta-row"><span class="k">点位已使用 DI/DO</span><span class="v">${configured(diModules)} / ${configured(doModules)} 条</span></div>
          <div class="meta-row"><span class="k">点位空余 DI/DO</span><span class="v">${spare(diModules)} / ${spare(doModules)} 条</span></div>`
            : `<div class="meta-row"><span class="k">模块</span><span class="v">${items.length} 个</span></div>
          <div class="meta-row"><span class="k">点位</span><span class="v">${points} 条</span></div>
          <div class="meta-row"><span class="k">待配置</span><span class="v">${unfilled} 条</span></div>`}
        </div>
        <div class="progress"><i class="${pct < 100 ? 'low' : ''}" style="width:${pct}%"></i></div>
        <div class="mod-card-ops"><button class="btn btn-ghost btn-sm act-open">${project ? '查看模块' : '查看控制柜'}</button></div>
      </div>`;
    }).join('');
    return;
  }
  wrap.innerHTML = `<div class="module-list-wrap"><table class="module-list">
    <thead><tr><th>模块号</th><th>模块类型</th><th>模块型号</th><th>已用 / 备用</th><th>使用率</th><th>操作</th></tr></thead>
    <tbody>${mods.map((m) => {
      const used = Number(m.configured_point_count || 0);
      const spare = Math.max(0, Number(m.channel_count || 0) - used);
      const pct = m.channel_count ? Math.min(100, Math.round((used / m.channel_count) * 100)) : 0;
      return `<tr class="module-list-row ${m.mine ? 'mine' : ''}" data-module="${m.id}">
        <td><strong>${esc(m.module_no)}</strong></td><td>${esc(m.module_type_name)}</td><td>${esc(m.module_model_name)}</td>
        <td>${used} / ${spare}</td><td><div class="progress module-list-progress"><i class="${pct < 100 ? 'low' : ''}" style="width:${pct}%"></i></div>${pct}%</td>
        <td class="module-list-actions"><button class="btn btn-ghost btn-sm act-open">查看明细</button>
          ${m.can_manage ? `<button class="btn btn-ghost btn-sm act-edit" data-mid="${m.id}">编辑</button>` : ''}
          ${m.can_manage ? `<button class="btn btn-danger btn-sm act-del" data-mid="${m.id}">删除</button>` : ''}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
  loadCabinetChannels(project.id,cabinet.id,mods,channelRequest);
}

/** 删除模块：统一入口，带二次确认 */
async function deleteModule(moduleId, meta) {
  if (!confirmDiscardPointDraft()) return;
  const name = meta
    ? `模块 ${meta.module_no}（${meta.cabinet_name} / ${meta.module_type_name}）`
    : '该模块';
  const pts = meta ? meta.point_count : null;
  const detail = pts !== null ? `\n\n其中包含 ${pts} 条点位记录，删除后不可恢复。` : '';
  if (!confirm(`确定删除${name}吗？${detail}`)) return;
  try {
    const r = await api(`/api/modules/${moduleId}`, { method: 'DELETE' });
    toast(`已删除模块及其 ${r.deletedPoints ?? 0} 条点位`, 'ok');
    state.currentModuleId = null;
    $('#deleteModuleBtn').hidden = true;
    $('#moduleOwner').hidden = true;
    await loadTree();
    showPage('overview');
    renderOverview();
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#moduleCards').addEventListener('click', (e) => {
  const edit=e.target.closest('.act-edit');
  if(edit){
    e.stopPropagation();
    if(!confirmDiscardPointDraft())return;
    const module=state.modules.find(item=>item.id===Number(edit.dataset.mid));
    if(!module)return;
    openFormModal({title:'编辑模块号',confirmText:'保存',fields:[{key:'module_no',label:'模块号',value:module.module_no,required:true,maxlength:32}],
      onConfirm:async values=>{
        const moduleNo=values.module_no.trim();if(!moduleNo)throw Error('模块号不能为空');
        await api(`/api/modules/${module.id}`,{method:'PUT',body:{module_no:moduleNo}});
        await loadTree();renderOverview();toast('模块号已更新','ok');
      }});
    return;
  }
  const del = e.target.closest('.act-del');
  if (del) {
    if (!confirmDiscardPointDraft()) return;
    e.stopPropagation();
    const id = Number(del.dataset.mid);
    const m = state.modules.find((x) => x.id === id);
    deleteModule(id, m);
    return;
  }
  if (!confirmDiscardPointDraft()) return;
  const card = e.target.closest('.mod-card');
  if (card?.dataset.projectOverview) return selectProject(Number(card.dataset.projectOverview));
  if (card?.dataset.cabinetOverview) return selectCabinet(Number(card.dataset.project), Number(card.dataset.cabinetOverview));
  const moduleRow = e.target.closest('[data-module]');
  if (!moduleRow) return;
  state.currentModuleId = Number(moduleRow.dataset.module);
  openModuleView();
});

$('#deleteModuleBtn').addEventListener('click', () => {
  if (!state.currentModuleId) return;
  const found = findModuleInTree(state.currentModuleId);
  deleteModule(state.currentModuleId, found ? found.module : null);
});

/* ================================================================== */
/* 点位表页                                                            */
/* ================================================================== */
function findModuleInTree(id) {
  for (const p of state.tree) {
    for (const c of p.cabinets) {
      const m = c.modules.find((x) => x.id === id);
      if (m) return { project: p, cabinet: c, module: m };
    }
  }
  return null;
}

function openModuleView() {
  const found = findModuleInTree(state.currentModuleId);
  const delBtn = $('#deleteModuleBtn');
  const ownerLine = $('#moduleOwner');
  if (found) {
    const { project, cabinet, module: m } = found;
    state.currentProjectId = project.id;
    state.currentCabinetId = cabinet.id;
    expandSelectedCabinet(project.id, cabinet.id);
    $('#pointsTitle').textContent = `${project.name} / ${cabinet.name} / 模块 ${m.module_no}`;
    $('#pointsSubtitle').textContent =
      `${m.module_type_name} · ${m.module_model_name} · 共 ${m.channel_count} 通道`;

    // 创建者与权限提示
    const isAdmin = state.user && state.user.role === 'admin';
    const canDel = m.can_manage;
    ownerLine.hidden = false;
    ownerLine.innerHTML =
      `创建者：<b>${esc(m.created_by_name || '访客')}</b>` +
      (m.mine ? ' <span class="tag-mine">我创建的</span>' : '') +
      (canDel
        ? ''
        : ' <span class="tag-locked">此模块由其他账号创建，无删除权限；点位字段可编辑</span>');
    delBtn.hidden = !canDel;
    delBtn.title = m.mine && !isAdmin ? '删除我创建的模块' : '删除该模块';
  } else {
    ownerLine.hidden = true;
    delBtn.hidden = true;
  }
  renderTree();
  showPage('points');
  refreshData();
}

async function refreshCurrent() {
  if (state.currentModuleId) await refreshData();
  else { renderTree(); renderOverview(); }
}

/** 返回总览 */
$('#backToOverview').addEventListener('click', () => {
  if (!confirmDiscardPointDraft()) return;
  showPage('overview');
  renderOverview();
});

async function loadConfig() {
  state.config = await api('/api/config');
}

async function loadSignals() {
  const r = await api('/api/signal-types');
  state.signals = r.items;
  if (state.user && state.user.role === 'admin') renderSignalTable();
}

function activeSignals() { return state.signals.filter((s) => s.active); }

function signalsForPart(param) {
  const part = state.config?.parts.find((p) => p.param === param);
  const type = String(findModuleInTree(state.currentModuleId)?.module.module_type_name || '').trim().toUpperCase();
  return part ? activeSignals().filter((s) => s.part_id === part.id
    && (!['DI', 'DO'].includes(type) || s.name.trim().toUpperCase().endsWith(type))) : [];
}

function signalOptions(part, signalId) {
  const signals = signalsForPart(part);
  const placeholder = !part ? '— 请先选择设备部位 —' : !signals.length ? '— 暂无匹配部位和模块的信号类型 —'
    : signalId && !signals.some((s) => s.id === signalId) ? '— 原信号不匹配部位或模块，请重新选择 —' : '— 未选择 —';
  return `<option value="">${placeholder}</option>` + signals.map((s) =>
    `<option value="${s.id}"${s.id === signalId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}

function signalChoiceLabel(part, signalId) {
  const signals = signalsForPart(part);
  return signals.find((signal) => signal.id === signalId)?.name
    || (!part ? '先选部位' : signals.length ? '请选择' : '暂无信号');
}

/* ------------------------------------------------------------------ */
/* 点位表                                                              */
/* ------------------------------------------------------------------ */
function fillSelect(sel, items, { valueKey = 'id', labelKey = 'name', placeholder } = {}) {
  sel.innerHTML =
    (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
    items.map((i) => `<option value="${esc(i[valueKey])}">${esc(i[labelKey])}</option>`).join('');
}

/** 批量部位下拉（现场 B / 电机 M…） */
function fillPartSelect() {
  const parts = (state.config && state.config.parts) || [];
  $('#bulkPart').innerHTML = parts
    .map((p) => `<option value="${esc(p.param)}">${esc(p.name)}（${esc(p.param)}）</option>`).join('');
}

async function refreshData() {
  if (!state.currentModuleId) { state.points = []; setPointsDirty(false); renderPoints(); renderStats(); return; }
  const r = await api(`/api/points?module_id=${state.currentModuleId}`);
  const moduleType = findModuleInTree(state.currentModuleId)?.module.module_type_name || '';
  state.points = r.items.map((point) => deriveDraftPoint({ ...point, module_type_name: moduleType }));
  setPointsDirty(false);
  renderPoints();
  renderStats();
}

function setPointsDirty(dirty = true) {
  state.pointsDirty = dirty;
  const btn = $('#savePointsBtn');
  const status = $('#pointsSaveState');
  if (btn) btn.disabled = !dirty;
  if (status) {
    status.hidden = !dirty;
    status.textContent = dirty ? '有未保存修改' : '';
  }
}

function confirmDiscardPointDraft() {
  if (!state.pointsDirty) return true;
  if (!confirm('当前模块有未保存的修改，确定放弃并离开吗？')) return false;
  setPointsDirty(false);
  return true;
}

window.addEventListener('beforeunload', (e) => {
  if (!state.pointsDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

$('#filterSearch').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderPoints();
});

function filteredPoints() {
  if (!state.search) return state.points;
  const k = state.search;
  return state.points.filter((r) =>
    [r.point_name, r.code, r.plc_point, r.plc_expression, r.signal_name, r.part, r.sensor_type]
      .some((v) => String(v || '').toLowerCase().includes(k)));
}

function renderPoints() {
  const rows = filteredPoints();
  const body = $('#pointsBody');
  $('#pointsEmpty').hidden = rows.length > 0;
  $('#pointsTable').hidden = rows.length === 0;

  const parts = (state.config && state.config.parts) || [];
  // 使用服务端返回的模块管理权限，访客也可删除任意模块内的点位。
  const found = findModuleInTree(state.currentModuleId);
  const canDelRow = !!found?.module.can_manage;

  body.innerHTML = rows.map((r) => {
    // 未填齐（部位/点位/信号类型任一为空）或无传感器 → Reserved
    const isReserved = r.code === 'Reserved';
    const incomplete = !r.part || !r.point_name || !r.signal_type_id;
    const codeCls = 'cell-auto cell-code'
      + (isReserved ? ' is-reserved' : '')
      + (incomplete && !isReserved ? ' is-pending' : '');

    const partOptions = ['<option value="">— 请选择 —</option>']
      .concat(parts.map((p) =>
        `<option value="${esc(p.param)}"${p.param === r.part ? ' selected' : ''}>${esc(p.name)}</option>`))
      .join('');
    const sigOptions = signalOptions(r.part, r.signal_type_id);

    return `
    <tr data-id="${r.id}" data-module="${r.module_id ?? ''}">
      <td class="cell-seq" data-label="序号">${esc(r.seq || '')}</td>
      <td data-label="设备部位">
        <select class="cell-edit" data-k="part">${partOptions}</select>
      </td>
      <td data-label="设备点位">
        <input class="cell-edit" data-k="point_name" value="${esc(r.point_name)}" placeholder="如 E13" maxlength="32" autocomplete="off">
      </td>
      <td data-label="信号类型">
        <div class="signal-choice">
          <select class="cell-edit" data-k="signal_type_id" aria-label="信号类型" title="${esc(signalChoiceLabel(r.part, r.signal_type_id))}"${signalsForPart(r.part).length ? '' : ' disabled'}>${sigOptions}</select>
          <span class="signal-choice-label" aria-hidden="true">${esc(signalChoiceLabel(r.part, r.signal_type_id))}</span>
        </div>
      </td>
      <td data-label="传感器类型">
        <div class="cell-auto">${esc(r.sensor_type || '—')}</div>
      </td>
      <td data-label="编号">
        <div class="${codeCls}">${esc(r.code)}</div>
      </td>
      <td data-label="PLC点位表达式">
        <input class="cell-auto cell-plc-expression" value="${esc(r.plc_expression || r.plc_point)}" title="${esc(r.plc_expression || r.plc_point)}" aria-label="自动生成的PLC点位表达式" readonly>
      </td>
      <td data-label="操作">
        <div class="op-btns">
          <button class="up" title="上移"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="dn" title="下移"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          ${canDelRow
            ? '<button class="del" title="删除该行"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
            : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderStats() {
  const all = state.points;
  const filled = all.filter((r) => r.code).length;
  const reserved = all.filter((r) => r.code === 'Reserved').length;
  const sensorKinds = new Set(all.map((r) => r.sensor_type).filter(Boolean)).size;
  $('#filterStats').innerHTML =
    `<span>点位 <b>${all.length}</b></span>` +
    `<span>已编号 <b>${filled}</b></span>` +
    `<span>Reserved <b>${reserved}</b></span>` +
    `<span>传感器种类 <b>${sensorKinds}</b></span>`;
}

function deriveDraftPoint(row) {
  const signal = state.signals.find((item) => item.id === Number(row.signal_type_id)) || null;
  const part = String(row.part || '').trim();
  const point = String(row.point_name || '').trim();
  row.sensor_type = signal?.sensor_type || '';
  row.code = !part || !point || !signal || signal.no_sensor || !signal.abbr
    ? 'Reserved' : `_${part}_${point}_${signal.abbr}`;
  const plc = String(row.plc_point || '').trim().replace(/:Q(?=W?\.)/g, ':O');
  if (plc && (!point || !signal)) {
    row.plc_expression = row.module_type_name === 'DI' ? `//Spare:=${plc};`
      : row.module_type_name === 'DO' ? `//${plc}:=Spare;` : plc;
  } else if (!signal?.program_name || !point || !plc) row.plc_expression = plc;
  else {
    const numbered = point.match(/^([A-Za-z])(\d+)$/);
    const variable = `${signal.program_name.trim()}_${numbered ? `${numbered[1]}${numbered[2].padStart(5, '0')}` : point}`;
    row.plc_expression = ['DO', 'AO'].includes(row.module_type_name) ? `${plc}:=${variable};` : `${variable}:=${plc};`;
  }
  return row;
}

/* 行内编辑只更新本地草稿，统一由「保存」按钮提交。 */
function uppercasePointInput(e) {
  const el = e.target.closest('input[data-k="point_name"]');
  if (!el || e.isComposing) return;
  const value = el.value.toUpperCase();
  if (value === el.value) return;
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = value;
  el.setSelectionRange(start, end);
}
$('#pointsBody').addEventListener('input', (e) => {
  uppercasePointInput(e);
  const el = e.target.closest('input[data-k="point_name"]');
  if (!el) return;
  const row = state.points.find((point) => point.id === Number(el.closest('tr').dataset.id));
  if (!row) return;
  row.point_name = el.value.toUpperCase();
  deriveDraftPoint(row);
  paintRow(el.closest('tr'), row);
  refreshSeqAndStats();
  setPointsDirty();
});
$('#pointsBody').addEventListener('compositionend', uppercasePointInput);
$('#pointsBody').addEventListener('change', (e) => {
  const el = e.target.closest('[data-k]');
  if (!el) return;
  const tr = el.closest('tr');
  const id = Number(tr.dataset.id);
  const key = el.dataset.k;
  if (key === 'point_name') el.value = el.value.toUpperCase();
  const value = key === 'signal_type_id' ? (el.value ? Number(el.value) : null) : el.value;
  const row = state.points.find((point) => point.id === id);
  if (!row) return;
  if (key === 'part') {
    row.part = value;
    const signalSelect = tr.querySelector('[data-k="signal_type_id"]');
    const validSignal = signalsForPart(value).some((signal) => signal.id === row.signal_type_id);
    if (!validSignal) row.signal_type_id = null;
    signalSelect.innerHTML = signalOptions(value, row.signal_type_id);
    signalSelect.disabled = !signalsForPart(value).length;
  } else row[key] = value;
  deriveDraftPoint(row);
  paintRow(tr, row);
  refreshSeqAndStats();
  setPointsDirty();
});

$('#savePointsBtn').addEventListener('click', async () => {
  if (!state.currentModuleId || !state.pointsDirty) return;
  const btn = $('#savePointsBtn');
  btn.disabled = true;
  btn.textContent = '正在保存…';
  try {
    await api(`/api/modules/${state.currentModuleId}/points`, {
      method: 'PUT',
      body: { points: state.points.map((point) => ({
        id: point.id, part: point.part, point_name: point.point_name,
        signal_type_id: point.signal_type_id, sort_order: point.sort_order,
      })) },
    });
    toast('模块点位已保存', 'ok');
    await loadTree();
    await refreshData();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.textContent = '保存';
    btn.disabled = !state.pointsDirty;
  }
});

/** 只更新一行的序号 / 传感器类型 / 编号，不动输入框 */
function paintRow(tr, row) {
  const signalSelect = tr.querySelector('[data-k="signal_type_id"]');
  if (signalSelect) {
    signalSelect.innerHTML = signalOptions(row.part, row.signal_type_id);
    signalSelect.disabled = !signalsForPart(row.part).length;
    signalSelect.title = signalChoiceLabel(row.part, row.signal_type_id);
    tr.querySelector('.signal-choice-label').textContent = signalChoiceLabel(row.part, row.signal_type_id);
  }
  const seqTd = tr.querySelector('[data-label="序号"]');
  const sensorBox = tr.querySelector('[data-label="传感器类型"] .cell-auto');
  const codeBox = tr.querySelector('.cell-code');
  const plcBox = tr.querySelector('.cell-plc-expression');
  if (plcBox) {
    plcBox.value = row.plc_expression || row.plc_point || '';
    plcBox.title = row.plc_expression || row.plc_point || '';
  }
  if (seqTd) seqTd.textContent = row.seq || '';
  if (sensorBox) sensorBox.textContent = row.sensor_type || '—';
  if (codeBox) {
    const isReserved = row.code === 'Reserved';
    const incomplete = !row.part || !row.point_name || !row.signal_type_id;
    codeBox.textContent = row.code || 'Reserved';
    codeBox.className = 'cell-auto cell-code'
      + (isReserved ? ' is-reserved' : '')
      + (incomplete && !isReserved ? ' is-pending' : '');
  }
  // 序号会因「设备部位」填写而整体重算
  if (row.seq) refreshSeqAndStats();
}

/** 重算全表序号显示（部位非空才计数，复刻 Excel COUNTA）
    搜索过滤时行会减少，故按 data-id 匹配而非按下标 */
function refreshSeqAndStats() {
  let seq = 0;
  state.points.forEach((p) => {
    if ((p.part || '').trim()) seq += 1;
    p.seq = (p.part || '').trim() ? seq : '';
  });
  $$('#pointsBody tr').forEach((tr) => {
    const p = state.points.find((x) => x.id === Number(tr.dataset.id));
    const td = tr.querySelector('[data-label="序号"]');
    if (p && td) td.textContent = p.seq || '';
  });
  renderStats();
}

/* 上下移 / 删除：仅修改本地草稿。 */
$('#pointsBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = Number(tr.dataset.id);

  if (btn.classList.contains('del')) {
    if (!confirm('确定删除该点位行？')) return;
    state.points = state.points.filter((point) => point.id !== id);
    renderPoints();
    refreshSeqAndStats();
    setPointsDirty();
    return;
  }
  const dir = btn.classList.contains('up') ? 'up' : 'down';
  const index = state.points.findIndex((point) => point.id === id);
  const target = index + (dir === 'up' ? -1 : 1);
  if (target < 0 || target >= state.points.length) return;
  [state.points[index], state.points[target]] = [state.points[target], state.points[index]];
  state.points.forEach((point, order) => { point.sort_order = order; });
  renderPoints();
  refreshSeqAndStats();
  setPointsDirty();
});

/* 批量设置部位只更新本地草稿。 */
$('#bulkPartBtn').addEventListener('click', () => {
  const part = $('#bulkPart').value;
  if (!part) return toast('请选择设备部位', 'warn');
  if (!state.currentModuleId) return toast('请先从左侧选择模块', 'warn');
  state.points.forEach((point) => {
    point.part = part;
    if (!signalsForPart(part).some((signal) => signal.id === Number(point.signal_type_id))) point.signal_type_id = null;
    deriveDraftPoint(point);
  });
  renderPoints();
  refreshSeqAndStats();
  setPointsDirty();
  toast('已应用到当前草稿，点击保存后写入数据库', 'ok');
});

/* ------------------------------------------------------------------ */
/* 新增模块                                                            */
/* ------------------------------------------------------------------ */
function openModuleModal() {
  if (!confirmDiscardPointDraft()) return;
  const c = state.config;
  if (!c.projects.length || !c.cabinets.length || !c.module_nos.length || !c.module_types.length || !c.module_models.length) {
    toast('请先由管理员在「基础配置」中维护各项下拉选项', 'warn');
    showPage('options');
    return;
  }
  fillSelect($('#mProject'), c.projects);
  fillSelect($('#mCabinet'), c.cabinets);
  const project = state.tree.find((p) => p.id === state.currentProjectId);
  if (c.projects.some((p) => p.id === state.currentProjectId)) {
    $('#mProject').value = String(state.currentProjectId);
  }
  const cabinetId = state.currentCabinetId ?? project?.cabinets[0]?.id;
  if (c.cabinets.some((cab) => cab.id === cabinetId)) {
    $('#mCabinet').value = String(cabinetId);
  }
  fillSelect($('#mNo'), c.module_nos);
  fillSelect($('#mType'), c.module_types);
  updateModelOptions();
  $('#mNote').value = '';
  $('#moduleMsg').textContent = '';
  updateConfirmState();
  updatePreview();
  $('#moduleModal').hidden = false;
}

/** 「完成」按钮可用性：五项必选齐全才可提交 */
function updateConfirmState() {
  const ids = ['#mProject', '#mCabinet', '#mNo', '#mType', '#mModel'];
  const allSet = ids.every((s) => {
    const el = $(s);
    return el && el.value !== '';
  });
  const btn = $('#moduleConfirm');
  btn.disabled = !allSet;
  const hint = $('#moduleFootHint');
  if (hint) {
    hint.textContent = allSet
      ? '完成后将写入数据库并生成对应点位行'
      : '请先完成上面 5 项必选配置';
  }
}

function updateModelOptions() {
  const typeId = Number($('#mType').value);
  const models = state.config.module_models.filter((m) => m.module_type_id === typeId);
  const sel = $('#mModel');
  sel.innerHTML = models.length
    ? models.map((m) => `<option value="${m.id}">${esc(m.name)}（${m.channel_count} 通道）</option>`).join('')
    : '<option value="">该类型下暂无模块型号</option>';
}

function updatePreview() {
  const c = state.config;
  const p = c.projects.find((x) => x.id === Number($('#mProject').value));
  const cab = c.cabinets.find((x) => x.id === Number($('#mCabinet').value));
  const no = c.module_nos.find((x) => x.id === Number($('#mNo').value));
  const mt = c.module_types.find((x) => x.id === Number($('#mType').value));
  const mm = c.module_models.find((x) => x.id === Number($('#mModel').value));
  const box = $('#previewBody');

  if (!mm) { box.textContent = '请选择模块型号以预览 PLC 点位'; return; }
  const prefix = mt ? mt.plc_prefix : 'I';
  const ch = mm.channel_count;
  const head = `将生成 <b>${ch}</b> 行点位（模块型号「${esc(mm.name)}」的总通道数）`;

  const rows = [];
  const shown = Math.min(ch, 8);
  for (let i = 0; i < shown; i++) {
    rows.push(`<div class="pv-row"><span class="pv-label">通道 ${i}</span>` +
      `<span class="pv-code">_${esc(cab ? cab.name : '柜号')}:${esc(no ? no.name : '模块号')}:${esc(prefix)}.${i}</span></div>`);
  }
  if (ch > shown) {
    rows.push(`<div class="pv-row"><span class="pv-label">…</span><span class="pv-hint">其余 ${ch - shown} 通道自动顺延</span></div>`);
  }
  box.innerHTML = `<div class="pv-row"><span class="pv-hint">${head}</span></div>` + rows.join('');
}

$('#mType').addEventListener('change', () => { updateModelOptions(); updatePreview(); updateConfirmState(); });
['#mProject', '#mCabinet', '#mNo', '#mModel'].forEach((s) =>
  $(s).addEventListener('change', () => { updatePreview(); updateConfirmState(); }));

$('#newModuleBtn').addEventListener('click', openModuleModal);
$('#newModuleBtn2').addEventListener('click', openModuleModal);
$('#emptyAddBtn2').addEventListener('click', openModuleModal);

$('#moduleConfirm').addEventListener('click', async () => {
  const msg = $('#moduleMsg');
  msg.textContent = '';
  const btn = $('#moduleConfirm');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '正在保存…';
  try {
    const r = await api('/api/modules', {
      method: 'POST',
      body: {
        project_id: Number($('#mProject').value),
        cabinet_id: Number($('#mCabinet').value),
        module_no: (state.config.module_nos.find((x) => x.id === Number($('#mNo').value)) || {}).name,
        module_type_id: Number($('#mType').value),
        module_model_id: Number($('#mModel').value),
        note: $('#mNote').value.trim(),
      },
    });
    $('#moduleModal').hidden = true;
    toast(`已完成：模块写入数据库，生成 ${r.created} 行点位`, 'ok');

    // 自动切换到新模块并展开到对应项目
    state.currentProjectId = r.module.project_id;
    state.currentModuleId = r.id;
    await loadTree();
    openModuleView();
  } catch (err) {
    msg.textContent = err.message;
    updateConfirmState();   // 校验失败则保持禁用，通过则恢复可点
    btn.disabled = false;
  } finally {
    btn.innerHTML = original;
  }
});

$$('#moduleModal [data-close]').forEach((b) => {
  b.addEventListener('click', () => { $('#moduleModal').hidden = true; });
});
$('#moduleModal').addEventListener('click', (e) => {
  if (e.target === $('#moduleModal')) $('#moduleModal').hidden = true;
});

/* ------------------------------------------------------------------ */
/* 导出                                                               */
/* ------------------------------------------------------------------ */
$('#exportBtn').addEventListener('click', () => {
  if (!state.currentModuleId) return toast('请先从左侧选择模块', 'warn');
  if (state.pointsDirty) return toast('请先保存或放弃未保存修改，再导出模块数据', 'warn');
  window.location.href = '/api/export?module_id=' + state.currentModuleId;
});
$('#overviewExportBtn').addEventListener('click', () => {
  if (!state.currentProjectId) return toast('请先选择项目或控制柜', 'warn');
  const params = new URLSearchParams({ project_id: state.currentProjectId });
  if (state.currentCabinetId) params.set('cabinet_id', state.currentCabinetId);
  window.location.href = '/api/export?' + params;
});

/* ------------------------------------------------------------------ */
/* 信号类型配置（管理员）                                              */
/* ------------------------------------------------------------------ */
function renderSignalTable() {
  $('#signalsBody').innerHTML = state.signals.map((s, i) => `
    <tr data-id="${s.id}" title="按住行拖动调整顺序">
      <td class="cell-seq signal-sort-cell" data-label="排序"><span class="signal-sort-handle" tabindex="0" role="button" aria-label="按住拖动调整顺序，也可使用上下方向键" title="按住拖动排序">⋮⋮</span><span class="signal-seq-no">${i + 1}</span></td>
      <td data-label="信号类型"><input class="cell-edit" data-k="name" value="${esc(s.name)}"></td>
      <td data-label="所属设备部位"><select class="cell-edit" data-k="part_id">
        <option value="">— 请选择 —</option>${(state.config?.parts || []).map((p) => `<option value="${p.id}"${p.id === s.part_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></td>
      <td data-label="简写"><input class="cell-edit mono" data-k="abbr" value="${esc(s.abbr)}" placeholder="${s.no_sensor ? 'Reserved' : '如 M'}"></td>
      <td data-label="传感器类型"><input class="cell-edit" data-k="sensor_type" value="${esc(s.sensor_type)}" placeholder="如 光幕"></td>
      <td data-label="程序名称"><input class="cell-edit" data-k="program_name" value="${esc(s.program_name)}" placeholder="请输入程序名称" maxlength="200"></td>
      <td data-label="操作">
        <div class="op-btns">
          <button class="del" title="删除"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </td>
    </tr>`).join('');
}

let signalRowSaves = 0;
async function saveSignalRow(id, patch) {
  signalRowSaves++;
  try {
    await api(`/api/signal-types/${id}`, { method: 'PUT', body: patch });
    await loadSignals();
    await loadTree();
    await refreshCurrent();
    toast('已保存', 'ok');
  } catch (err) { toast(err.message, 'err'); await loadSignals(); }
  finally { signalRowSaves--; }
}

/* 信号类型排序：桌面拖放，触屏长按后拖动；顺序保存在数据库。 */
let signalDrag = null;
let signalHold = null;
let signalSaving = false;
function beginSignalDrag(row, type) {
  if (signalSaving || signalRowSaves) return;
  signalDrag = { row, type, original: $$('#signalsBody tr').map(r => Number(r.dataset.id)) };
  row.classList.add('is-dragging');
  $('#signalsBody').classList.add('is-sorting');
}

function moveSignalDrag(y) {
  if (!signalDrag) return;
  const body = $('#signalsBody');
  const before = $$('tr', body).find(row => row !== signalDrag.row && y < row.getBoundingClientRect().top + row.offsetHeight / 2);
  body.insertBefore(signalDrag.row, before || null);
  $$('tr', body).forEach((row, index) => { $('.signal-seq-no', row).textContent = index + 1; });
}

async function finishSignalDrag(cancel = false) {
  clearTimeout(signalHold?.timer);
  signalHold = null;
  if (!signalDrag) return;
  const drag = signalDrag;
  signalDrag = null;
  drag.row.classList.remove('is-dragging');
  $('#signalsBody').classList.remove('is-sorting');
  const ids = $$('#signalsBody tr').map(row => Number(row.dataset.id));
  if (cancel) { renderSignalTable(); return; }
  if (ids.every((id, index) => id === drag.original[index])) return;
  signalSaving = true;
  $('#signalsBody').classList.add('is-saving');
  try {
    await api('/api/signal-types/reorder', { method: 'POST', body: { ids } });
    await loadSignals();
    await loadTree();
    await refreshCurrent();
    toast('信号类型顺序已保存', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    await loadSignals();
  } finally {
    signalSaving = false;
    $('#signalsBody').classList.remove('is-saving');
  }
}

$('#signalsBody').addEventListener('mousedown', e => {
  if (e.button !== 0 || signalSaving || signalRowSaves || e.target.closest('input, select, button')) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  signalHold = { type: 'mouse', x: e.clientX, y: e.clientY, row,
    timer: setTimeout(() => { signalHold = null; beginSignalDrag(row, 'mouse'); }, 180) };
});
document.addEventListener('mousemove', e => {
  if (signalDrag?.type === 'mouse') {
    e.preventDefault();
    moveSignalDrag(e.clientY);
  } else if (signalHold?.type === 'mouse' && Math.hypot(e.clientX - signalHold.x, e.clientY - signalHold.y) > 8) {
    clearTimeout(signalHold.timer); signalHold = null;
  }
});
document.addEventListener('mouseup', () => {
  if (signalDrag?.type === 'mouse') finishSignalDrag();
  else if (signalHold?.type === 'mouse') { clearTimeout(signalHold.timer); signalHold = null; }
});
$('#signalsBody').addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { finishSignalDrag(true); return; }
  if (signalSaving || signalRowSaves || e.target.closest('input, select, button')) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const touch = e.touches[0];
  signalHold = { type: 'touch', x: touch.clientX, y: touch.clientY, row,
    timer: setTimeout(() => beginSignalDrag(row, 'touch'), 350) };
}, { passive: true });
$('#signalsBody').addEventListener('touchmove', e => {
  const touch = e.touches[0];
  if (!touch) return;
  if (signalDrag?.type === 'touch') {
    e.preventDefault();
    moveSignalDrag(touch.clientY);
  } else if (signalHold && Math.hypot(touch.clientX - signalHold.x, touch.clientY - signalHold.y) > 8) {
    clearTimeout(signalHold.timer); signalHold = null;
  }
}, { passive: false });
$('#signalsBody').addEventListener('touchend', () => finishSignalDrag());
$('#signalsBody').addEventListener('touchcancel', () => finishSignalDrag(true));
$('#signalsBody').addEventListener('contextmenu', e => { if (signalHold || signalDrag) e.preventDefault(); });
$('#signalsBody').addEventListener('keydown', e => {
  if (e.key === 'Escape') { finishSignalDrag(true); return; }
  const handle = e.target.closest('.signal-sort-handle');
  if (!handle || !['ArrowUp', 'ArrowDown'].includes(e.key) || signalSaving || signalRowSaves) return;
  e.preventDefault();
  const row = handle.closest('tr');
  const sibling = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  beginSignalDrag(row, 'keyboard');
  $('#signalsBody').insertBefore(row, e.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  finishSignalDrag();
});

$('#signalsBody').addEventListener('change', (e) => {
  const el = e.target.closest('[data-k]');
  if (!el) return;
  const id = Number(el.closest('tr').dataset.id);
  const k = el.dataset.k;
  const patch = {};
  patch[k] = el.value;
  saveSignalRow(id, patch);
});

$('#signalsBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button.del');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.id);
  if (!confirm('确定删除该信号类型？')) return;
  try {
    await api(`/api/signal-types/${id}`, { method: 'DELETE' });
    toast('已删除', 'ok');
    await loadSignals();
  } catch (err) { toast(err.message, 'err'); }
});

$('#addSignalBtn').addEventListener('click', () => {
  openFormModal({
    title: '新增信号类型',
    confirmText: '新增',
    fields: [
      { key: 'name', label: '信号类型名称', required: true, placeholder: '如 光幕' },
      { key: 'part_id', label: '所属设备部位', type: 'select', required: true, options:
        [{ value: '', label: '请选择设备部位' }, ...(state.config?.parts || []).map((p) => ({ value: p.id, label: p.name }))] },
      { key: 'abbr', label: '编号简写', placeholder: '如 M' },
      { key: 'sensor_type', label: '传感器类型', placeholder: '如 光幕' },
      { key: 'program_name', label: '程序名称', placeholder: '请输入程序名称', maxlength: 200 },
    ],
    onConfirm: async (v) => {
      await api('/api/signal-types', { method: 'POST', body: v });
      await loadSignals();
      toast('已新增', 'ok');
      return true;
    },
  });
});

/* ------------------------------------------------------------------ */
/* 基础配置（管理员）                                                  */
/* ------------------------------------------------------------------ */
async function loadOptions() { await loadConfig(); renderOptions(); }

const OPT_META = {
  projects:    { table: 'projects',    label: '项目名称' },
  cabinets:    { table: 'cabinets',    label: '柜子号' },
  module_nos:  { table: 'module_nos',  label: '模块号' },
  module_types:{ table: 'module_types',label: '模块类型' },
  parts:       { table: 'parts',       label: '设备部位' },
};

function renderOptions() {
  Object.entries(OPT_META).forEach(([key, meta]) => {
    const items = state.config[key];
    const el = $('#opt-' + key);
    if (!items.length) {
      el.innerHTML = '<div class="opt-empty">暂无选项，点击右上角新增</div>';
      return;
    }
    el.innerHTML = items.map((it) => `
      <div class="opt-row" data-kind="${key}" data-id="${it.id}"${key === 'projects' ? ' draggable="true"' : ''}>
        ${key === 'projects' ? '<button type="button" class="project-drag-handle" aria-label="按住拖动排序，也可使用上下方向键" title="按住拖动排序">⋮⋮</button>' : ''}
        <span class="opt-name">${esc(it.name)}</span>
        ${it.param ? `<span class="opt-tag">${esc(it.param)}</span>` : ''}
        ${it.plc_prefix ? `<span class="opt-tag">PLC ${esc(it.plc_prefix)}</span>` : ''}
        <button class="icon-btn btn-icon ed" title="编辑"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17v3z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn btn-icon del" title="删除"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>`).join('');
  });

  // 模块型号
  const mm = state.config.module_models;
  $('#opt-module_models').innerHTML = mm.length ? mm.map((m) => `
    <div class="opt-row" data-kind="module_models" data-id="${m.id}">
      <span class="opt-name">${esc(m.name)}</span>
      <span class="opt-tag">${esc(m.module_type_name)}</span>
      <span class="opt-sub">${m.channel_count} 通道 · PLC ${esc(m.plc_prefix)}</span>
      <button class="icon-btn btn-icon ed" title="编辑"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17v3z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/></svg></button>
      <button class="icon-btn btn-icon del" title="删除"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>`).join('') : '<div class="opt-empty">暂无模块型号</div>';
}

/* 项目排序：桌面拖放，触屏长按后拖动；点击编辑/删除不触发拖动。 */
const projectList = $('#opt-projects');
let projectDrag = null;
let projectHold = null;
let projectSaving = false;

function beginProjectDrag(row, type) {
  if (projectSaving) return;
  projectDrag = { row, type, original: $$('.opt-row', projectList).map(r => Number(r.dataset.id)) };
  row.classList.add('is-dragging');
  projectList.classList.add('is-sorting');
}

function moveProjectDrag(y) {
  if (!projectDrag) return;
  const before = $$('.opt-row', projectList).find(row => row !== projectDrag.row && y < row.getBoundingClientRect().top + row.offsetHeight / 2);
  projectList.insertBefore(projectDrag.row, before || null);
}

async function finishProjectDrag(cancel = false) {
  clearTimeout(projectHold?.timer);
  projectHold = null;
  if (!projectDrag) return;
  const drag = projectDrag;
  projectDrag = null;
  drag.row.classList.remove('is-dragging');
  projectList.classList.remove('is-sorting');
  const ids = $$('.opt-row', projectList).map(row => Number(row.dataset.id));
  if (cancel) { renderOptions(); return; }
  if (ids.every((id, index) => id === drag.original[index])) return;
  projectSaving = true;
  projectList.classList.add('is-saving');
  try {
    await api('/api/config/projects/reorder', { method: 'POST', body: { ids } });
    await loadConfig();
    renderOptions();
    await loadTree();
    renderOverview();
    toast('项目排序已保存', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    await loadConfig().catch(() => {});
    renderOptions();
  } finally {
    projectSaving = false;
    projectList.classList.remove('is-saving');
  }
}

projectList.addEventListener('dragstart', e => {
  const row = e.target.closest('.opt-row');
  if (!row || projectSaving) { e.preventDefault(); return; }
  beginProjectDrag(row, 'mouse');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.id);
});
projectList.addEventListener('mousedown', e => {
  const row = e.target.closest('.opt-row');
  if (row) row.draggable = !e.target.closest('.ed, .del');
});
projectList.addEventListener('dragover', e => {
  if (projectDrag?.type !== 'mouse') return;
  e.preventDefault();
  moveProjectDrag(e.clientY);
});
projectList.addEventListener('drop', e => {
  if (projectDrag?.type !== 'mouse') return;
  e.preventDefault();
  finishProjectDrag();
});
projectList.addEventListener('dragend', () => finishProjectDrag(true));
projectList.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { finishProjectDrag(true); return; }
  if (projectSaving || e.target.closest('.ed, .del')) return;
  const row = e.target.closest('.opt-row');
  if (!row) return;
  const touch = e.touches[0];
  projectHold = { x: touch.clientX, y: touch.clientY,
    timer: setTimeout(() => beginProjectDrag(row, 'touch'), 350) };
}, { passive: true });
projectList.addEventListener('touchmove', e => {
  const touch = e.touches[0];
  if (!touch) return;
  if (projectDrag?.type === 'touch') {
    e.preventDefault();
    const bounds = projectList.getBoundingClientRect();
    if (touch.clientY < bounds.top + 24) projectList.scrollTop -= 12;
    if (touch.clientY > bounds.bottom - 24) projectList.scrollTop += 12;
    moveProjectDrag(touch.clientY);
  } else if (projectHold && Math.hypot(touch.clientX - projectHold.x, touch.clientY - projectHold.y) > 8) {
    clearTimeout(projectHold.timer); projectHold = null;
  }
}, { passive: false });
projectList.addEventListener('touchend', () => finishProjectDrag());
projectList.addEventListener('touchcancel', () => finishProjectDrag(true));
projectList.addEventListener('contextmenu', e => {
  if (projectHold || projectDrag) e.preventDefault();
});
projectList.addEventListener('keydown', e => {
  if (e.key === 'Escape') { finishProjectDrag(true); return; }
  const handle = e.target.closest('.project-drag-handle');
  if (!handle || !['ArrowUp', 'ArrowDown'].includes(e.key) || projectSaving) return;
  e.preventDefault();
  const row = handle.closest('.opt-row');
  const sibling = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  beginProjectDrag(row, 'keyboard');
  projectList.insertBefore(row, e.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  finishProjectDrag();
});

/* 新增选项 */
$$('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.add;
    const fields = [{ key: 'name', label: OPT_META[kind] ? OPT_META[kind].label : '模块型号', required: true, full: true }];
    if (kind === 'module_types') {
      fields.push({ key: 'plc_prefix', label: 'PLC 前缀', placeholder: '如 I / Q / IW / QW', required: true });
    }
    if (kind === 'parts') {
      fields.push({ key: 'param', label: '编号参数', placeholder: '如 B', required: true });
    }
    if (kind === 'module_models') {
      fields.unshift({
        key: 'module_type_id', label: '模块类型', type: 'select', required: true, full: true,
        options: state.config.module_types.map((t) => ({ value: t.id, label: `${t.name}（PLC ${t.plc_prefix}）` })),
      });
      fields.push({ key: 'channel_count', label: '总通道数', type: 'number', required: true, placeholder: '如 8' });
    }
    openFormModal({
      title: '新增' + (OPT_META[kind] ? OPT_META[kind].label : '模块型号'),
      confirmText: '新增',
      fields,
      onConfirm: async (v) => {
        if (kind === 'module_models') {
          await api('/api/module-models', {
            method: 'POST',
            body: { name: v.name, module_type_id: Number(v.module_type_id), channel_count: Number(v.channel_count) },
          });
        } else {
          await api(`/api/config/${kind}`, { method: 'POST', body: v });
        }
        await loadConfig(); fillPartSelect(); renderOptions(); await loadTree();
        toast('已新增', 'ok');
        return true;
      },
    });
  });
});

/* 编辑 / 删除选项（事件委托） */
document.addEventListener('click', async (e) => {
  const row = e.target.closest('.opt-row');
  if (!row) return;
  const kind = row.dataset.kind;
  const id = Number(row.dataset.id);

  if (e.target.closest('.del')) {
    if (!confirm('确定删除该选项？')) return;
    try {
      if (kind === 'module_models') await api(`/api/module-models/${id}`, { method: 'DELETE' });
      else await api(`/api/config/${kind}/${id}`, { method: 'DELETE' });
      await loadConfig(); fillPartSelect(); renderOptions(); await loadTree(); await refreshCurrent();
      toast('已删除', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    return;
  }

  if (e.target.closest('.ed')) {
    const item = kind === 'module_models'
      ? state.config.module_models.find((m) => m.id === id)
      : state.config[kind].find((x) => x.id === id);
    if (!item) return;

    const fields = [{ key: 'name', label: '名称', required: true, full: true, value: item.name }];
    if (kind === 'module_types') {
      fields.push({ key: 'plc_prefix', label: 'PLC 前缀', required: true, value: item.plc_prefix });
    }
    if (kind === 'parts') {
      fields.push({ key: 'param', label: '编号参数', required: true, value: item.param });
    }
    if (kind === 'module_models') {
      fields.unshift({
        key: 'module_type_id', label: '模块类型', type: 'select', full: true,
        options: state.config.module_types.map((t) => ({
          value: t.id, label: `${t.name}（PLC ${t.plc_prefix}）`, selected: t.id === item.module_type_id })),
      });
      fields.push({ key: 'channel_count', label: '总通道数', type: 'number', required: true, value: item.channel_count });
    }

    openFormModal({
      title: '编辑',
      fields,
      onConfirm: async (v) => {
        if (kind === 'module_models') {
          await api(`/api/module-models/${id}`, {
            method: 'PUT',
            body: { name: v.name, module_type_id: Number(v.module_type_id), channel_count: Number(v.channel_count) },
          });
        } else {
          await api(`/api/config/${kind}/${id}`, { method: 'PUT', body: v });
        }
        await loadConfig(); fillPartSelect(); renderOptions(); await loadTree(); await refreshCurrent();
        toast('已保存', 'ok');
        return true;
      },
    });
  }
});

/* ------------------------------------------------------------------ */
/* 用户管理（管理员）                                                  */
/* ------------------------------------------------------------------ */
async function loadUsers() {
  const r = await api('/api/users');
  $('#usersBody').innerHTML = r.items.map((u) => `
    <tr data-id="${u.id}">
      <td class="cell-seq" data-label="序号">${u.id}</td>
      <td data-label="用户名"><strong>${esc(u.username)}</strong>${u.must_change_pwd ? ' <span class="opt-sub">待改密</span>' : ''}</td>
      <td data-label="角色">${u.role === 'admin' ? '<span class="opt-tag">管理员</span>' : '<span class="opt-sub">普通用户</span>'}</td>
      <td class="c-center" data-label="状态">${u.disabled ? '<span class="opt-sub">已停用</span>' : '<span class="opt-sub">正常</span>'}</td>
      <td data-label="创建时间"><span class="opt-sub">${esc((u.created_at || '').slice(0, 19).replace('T', ' '))}</span></td>
      <td data-label="操作">
        <div class="op-btns">
          <button class="ed" title="编辑"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L19 9a2.1 2.1 0 10-3-3L5 17v3z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/></svg></button>
          <button class="del" title="删除"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </td>
    </tr>`).join('');
}

$('#usersBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = Number(btn.closest('tr').dataset.id);
  const r = await api('/api/users');
  const u = r.items.find((x) => x.id === id);
  if (!u) return;

  if (btn.classList.contains('del')) {
    if (!confirm(`确定删除用户「${u.username}」？`)) return;
    try { await api(`/api/users/${id}`, { method: 'DELETE' }); await loadUsers(); toast('已删除', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    return;
  }

  openFormModal({
    title: '编辑用户',
    fields: [
      { key: 'role', label: '角色', type: 'select', full: true,
        options: [
          { value: 'user', label: '普通用户（仅现场设备点位表）', selected: u.role === 'user' },
          { value: 'admin', label: '管理员（可配置信号类型）', selected: u.role === 'admin' },
        ] },
      { key: 'disabled', label: '停用该账号', type: 'switch', checked: u.disabled, full: true },
      { key: 'password', label: '重置密码（留空则不修改）', type: 'password', placeholder: '至少 6 位', full: true },
    ],
    onConfirm: async (v) => {
      const body = { role: v.role, disabled: v.disabled };
      if (v.password) body.password = v.password;
      await api(`/api/users/${id}`, { method: 'PUT', body });
      await loadUsers();
      toast('已保存', 'ok');
      return true;
    },
  });
});

$('#addUserBtn').addEventListener('click', () => {
  openFormModal({
    title: '新增用户',
    confirmText: '新增',
    fields: [
      { key: 'username', label: '用户名', required: true, placeholder: '3–32 位字母数字', full: true },
      { key: 'password', label: '初始密码', type: 'password', required: true, placeholder: '至少 6 位', full: true },
      { key: 'role', label: '角色', type: 'select', full: true,
        options: [
          { value: 'user', label: '普通用户（仅现场设备点位表）', selected: true },
          { value: 'admin', label: '管理员（可配置信号类型）' },
        ] },
    ],
    onConfirm: async (v) => {
      await api('/api/users', { method: 'POST', body: v });
      await loadUsers();
      toast('已新增', 'ok');
      return true;
    },
  });
});

$('#pwdNavBtn').addEventListener('click', () => {
  openFormModal({
    title: '修改密码',
    fields: [
      { key: 'oldPassword', label: '原密码', type: 'password', required: true, full: true },
      { key: 'newPassword', label: '新密码（至少 6 位）', type: 'password', required: true, full: true },
    ],
    onConfirm: async (v) => {
      await api('/api/auth/password', { method: 'POST', body: v });
      toast('密码已更新', 'ok');
      return true;
    },
  });
});

/* ------------------------------------------------------------------ */
/* PWA 安装                                                           */
/* ------------------------------------------------------------------ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) {
    toast('请用浏览器菜单中的「添加到主屏幕」安装', 'warn');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('#installBtn').hidden = true;
  toast('已安装到桌面', 'ok');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */
window.__state = state;
window.__api = {
  loadTree, renderOverview, renderTree, renderPoints,
  openModuleView, refreshData, showPage,
};

(async function boot() {
  try {
    const r = await api('/api/auth/me');
    state.user = r.user;
  } catch (err) {
    toast('无法读取登录状态：' + err.message, 'warn');
  }
  try {
    await enterApp();
  } catch (err) {
    toast('加载项目失败：' + err.message, 'warn');
  }
})();
