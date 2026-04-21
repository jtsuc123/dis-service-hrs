// ============================================================
// app.js — Frontend logic (ES module)
// ============================================================
import { supabase } from './supabase.js';
import { signInWithGoogle, signOut, getUserRole } from './auth.js';
import {
  getActiveSY, getMasterRoster, addStudentToRoster, bulkImportStudents,
  updateStudent, deleteStudentFromRoster, searchStudents,
  getOrgList, createOrg, deleteOrg, renameOrg, getOrgEditorData,
  addStudentToOrg, removeStudentFromOrg, updateMemberRole,
  addSession, deleteSessionHours, deleteSession,
  addMiscHours, getMiscHours, deleteMiscHours,
  getStudentData, getAdminSummary, startNewSchoolYear,
  submitFlag, getFlags, resolveFlag, deleteFlag,
  submitOffCampus, getOffCampusPending, updateOffCampusStatus,
  getSettings, saveSuperAdmins, saveOrgEditors, fmtDate,
} from './db.js';

// ── STATE ─────────────────────────────────────────────────────
const S = {
  role: '', email: '', displayName: '',
  adminData: null, teacherData: null, rosterData: null, settings: null,
  currentOrgId: null, currentOrgName: '',
  miscStu: null, addStu: null,
  adminSort: { col: 'name', dir: 1 },
};

const CHARTS = {};
const TIMERS = {};
const GRADE_BG = { G9RL:'#dbeafe',G9RP:'#dbeafe',G9:'#dbeafe',G10A:'#d1fae5',G10P:'#d1fae5',G10:'#d1fae5',G11A:'#fef9c3',G11L:'#fef9c3',G11:'#fef9c3',G12V:'#fce7f3',G12P:'#fce7f3',G12:'#fce7f3' };
const GRADE_TC = { G9RL:'#1e40af',G9RP:'#1e40af',G9:'#1e40af',G10A:'#065f46',G10P:'#065f46',G10:'#065f46',G11A:'#713f12',G11L:'#713f12',G11:'#713f12',G12V:'#9d174d',G12P:'#9d174d',G12:'#9d174d' };
const HOUSE_COLORS = { '1-Truthful':'#ef4444','2-Organized':'#14b8a6','3-Reflective':'#8b5cf6','4-Courageous':'#f97316','5-Helpful':'#6366f1' };
const CC = ['#3b82f6','#f97316','#22c55e','#a855f7','#f43f5e','#0ea5e9','#eab308','#14b8a6','#6366f1','#ec4899'];
const GRADE_ORDER = ['G9RL','G9RP','G9','G10A','G10P','G10','G11A','G11L','G11','G12V','G12P','G12'];

// ── INIT ──────────────────────────────────────────────────────
window.handleSignIn = async () => {
  try { await signInWithGoogle(); } catch (e) { toast('Sign-in failed: ' + e.message, 'err'); }
};
window.handleSignOut = async () => {
  await signOut();
};

supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT' || !session) {
    document.body.classList.add('hide-sidebar');
    show('pgLogin');
    return;
  }
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    await init();
  }
});

async function init() {
  show('pgLoad');
  try {
    const r = await getUserRole();
    S.role = r.role; S.email = r.email; S.displayName = r.displayName ?? '';
    setUserChip(r.displayName, r.email);
    el('signOutBtn').style.display = 'flex';

    if (r.role === 'no_access' || r.role === 'unauthenticated') {
      el('naEmail').textContent = r.email;
      document.body.classList.add('hide-sidebar');
      show('pgNo');
      return;
    }
    document.body.classList.remove('hide-sidebar');

    const sy = await getActiveSY();
    el('sbSY').textContent = sy;

    if (r.role === 'super_admin') {
      el('viewAsWrap').style.display = 'block';
      buildNav(NAV_ADMIN);
      await loadAdmin();
    } else if (r.role === 'teacher') {
      S.currentOrgId = r.orgs?.[0] ?? null;
      el('viewAsWrap').style.display = 'block';
      buildNav(NAV_TEACHER);
      if (S.currentOrgId) await loadTeacher(S.currentOrgId);
      else show('pgTeacher');
    } else {
      buildNav(NAV_STUDENT);
      await loadStudent(r.email);
    }
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    show('pgLogin');
  }
}

// ── NAV ───────────────────────────────────────────────────────
const NAV_ADMIN = [
  { sec: 'OVERVIEW' }, { id: 'dash', icon: '◈', label: 'Dashboard', view: 'Dash' },
  { sec: 'STUDENTS' }, { id: 'students', icon: '👥', label: 'Hours Overview', view: 'Students' }, { id: 'roster', icon: '📋', label: 'Master Roster', view: 'Roster' },
  { sec: 'MANAGEMENT' }, { id: 'orgs', icon: '🏛', label: 'Organizations', view: 'Orgs' }, { id: 'flags', icon: '⚑', label: 'Flags', view: 'Flags', badge: 'fBadge' }, { id: 'oc', icon: '🌐', label: 'Off-Campus', view: 'OC', badge: 'ocBadge' }, { id: 'misc', icon: '✦', label: 'Misc Hours', view: 'MiscAdmin' },
  { sec: 'SYSTEM' }, { id: 'settings', icon: '⚙', label: 'Settings', view: 'Settings' },
];
const NAV_TEACHER = [
  { id: 'teach', icon: '✏', label: 'My Organization' },
];
const NAV_STUDENT = [
  { sec: 'SERVICE HOURS' }, { id: 'myhr', icon: '◈', label: 'My Hours' }, { id: 'offcampus', icon: '🌐', label: 'Submit Off-Campus' },
];

function buildNav(items) {
  const nav = el('sideNav'); nav.innerHTML = '';
  items.forEach(item => {
    if (item.sec) { const s = document.createElement('div'); s.className = 'nav-section-lbl'; s.textContent = item.sec; nav.appendChild(s); return; }
    const a = document.createElement('div'); a.className = 'nav-item'; a.dataset.id = item.id;
    a.innerHTML = `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>${item.badge ? `<span class="nav-badge" id="${item.badge}" style="display:none">0</span>` : ''}`;
    a.onclick = () => navTo(item); nav.appendChild(a);
  });
}

function navTo(item) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const ni = document.querySelector(`.nav-item[data-id="${item.id}"]`);
  if (ni) ni.classList.add('active');
  el('topTitle').textContent = item.label;
  if (item.view) { showAdminView(item.view); return; }
  if (item.id === 'teach') { show('pgTeacher'); }
  else if (item.id === 'myhr') { show('pgStudent'); }
  else if (item.id === 'offcampus') { openModal('mOffCampus'); navActive('myhr'); }
}

function navActive(id) { document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.id === id)); }

function showAdminView(v) {
  show('pgAdmin');
  ['Dash','Students','Roster','Orgs','Flags','OC','MiscAdmin','Settings'].forEach(n => el('view' + n).style.display = 'none');
  el('view' + v).style.display = 'block';
  if (v === 'Flags') loadFlags();
  if (v === 'OC') loadOC();
  if (v === 'Settings') loadSettings();
  if (v === 'Roster' && S.rosterData) renderRoster();
  if (v === 'MiscAdmin') loadMiscAdmin();
  if (v === 'Orgs') renderOrgGrid();
}

// ── USER CHIP ─────────────────────────────────────────────────
function getGreeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function setUserChip(displayName, email) {
  const name = displayName || email?.split('@')[0] || '';
  const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  el('userChip').style.display = 'flex';
  el('userChipAv').textContent = ini;
  el('userChipName').textContent = name.split(' ')[0] || name;
  el('sbAv').textContent = ini;
  el('sbEmail').textContent = name;
  const rl = { super_admin: 'Super Admin', teacher: 'Teacher', student: 'Student' };
  el('sbRoleLabel').textContent = rl[S.role] || S.role;
}

// ── STUDENT PAGE ──────────────────────────────────────────────
async function loadStudent(email) {
  show('pgLoad');
  try {
    const d = await getStudentData(email);
    if (!d) { toast('Student not found in roster', 'warn'); show('pgStudent'); return; }
    renderStudent(d);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

function renderStudent(d) {
  el('sbSync').textContent = 'Synced ' + d.lastSync;
  const ini = ((d.firstName || '')[0] + (d.lastName || '?')[0]).toUpperCase();
  el('pAv').textContent = ini;
  const greet = S.role === 'super_admin' || S.asStu ? '' : getGreeting() + ', ';
  el('pName').textContent = greet + (d.firstName || '');
  el('pSubname').textContent = d.firstName + ' ' + d.lastName;
  el('pCurHrs').textContent = d.currentHrs;
  el('pCumul').textContent = (d.cumulHrs || 0) + ' hrs';

  let tags = '';
  const gc = GRADE_BG[d.class_] || '#e5e7eb', gt = GRADE_TC[d.class_] || '#374151';
  if (d.class_) tags += `<span class="ptag" style="background:${gc};color:${gt}">${esc(d.class_)}</span>`;
  if (d.house) { const hc = HOUSE_COLORS[d.house]; tags += `<span class="ptag" style="background:${hc}22;color:${hc}">${esc(d.house)}</span>`; }
  if (d.id) tags += `<span class="ptag" style="background:rgba(0,0,0,.05);color:var(--text3);font-family:monospace;font-size:10px">${esc(d.id)}</span>`;
  el('pTags').innerHTML = tags;

  if (d.orgs && d.orgs.length) {
    el('sCharts').style.display = 'grid';
    destroyChart('cSOrg');
    mkChart('cSOrg', 'bar', d.orgs.map(o => o.orgName), d.orgs.map(o => o.totalHrs), CC.slice(0, d.orgs.length), { xl: 'Organization', yl: 'Hours' });
    const sk = Object.keys(d.syHrs || {}).sort();
    if (sk.length) {
      const mx = Math.max(...sk.map(k => d.syHrs[k] || 0)) || 1;
      el('sHistBars').innerHTML = sk.map(sy => {
        const h = d.syHrs[sy] || 0;
        return `<div class="sy-row"><div class="sy-lbl">${esc(sy)}</div><div class="sy-bar-bg"><div class="sy-bar-fg" style="width:${Math.round(h / mx * 100)}%"></div></div><div class="sy-num">${h} hrs</div></div>`;
      }).join('');
    }
  } else { el('sCharts').style.display = 'none'; }

  const stack = el('sOrgs'); stack.innerHTML = '';
  if (!d.orgs || !d.orgs.length) {
    stack.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No service hours recorded yet</div></div>';
  } else {
    d.orgs.forEach(o => {
      const sc = orgColor(o.orgName);
      let sessHtml = '';
      if (o.sessions && o.sessions.length) {
        sessHtml = '<table class="sess-table"><thead><tr><th>Session / Task</th><th>Date</th><th>Hours</th>' + (o.orgName === 'Misc Hours' ? '<th>Teacher</th>' : '') + '<th></th></tr></thead><tbody>';
        o.sessions.forEach((s, si) => {
          const descId = 'desc_' + si + '_' + Math.random().toString(36).slice(2, 6);
          const hasDesc = s.description && s.description.trim();
          sessHtml += `<tr><td><div style="font-weight:500;cursor:pointer" onclick="togDesc('${descId}')">${esc(s.sessionName || s.date)}${hasDesc ? ' <span style="color:var(--text3);font-size:10px">ⓘ</span>' : ''}</div>${hasDesc ? `<div id="${descId}" style="display:none;font-size:11px;color:var(--text2);margin-top:3px;padding:5px 8px;background:var(--bg2);border-radius:5px;border:1px solid var(--border)">${esc(s.description)}</div>` : ''}</td><td style="color:var(--text2)">${esc(s.date)}</td><td>${s.hrs} hrs</td>${o.orgName === 'Misc Hours' ? `<td style="font-size:11px;color:var(--text2)">${esc(s.teacherName || '')}</td>` : ''}<td><button class="flag-btn" onclick="openFlag('${escJ(o.orgName)}','${escJ(s.sessionName || s.date)}',${s.hrs})">Flag</button></td></tr>`;
        });
        sessHtml += '</tbody></table>';
      } else { sessHtml = '<div style="padding:11px 16px;font-size:12px;color:var(--text3);font-style:italic">No sessions recorded yet.</div>'; }

      const blk = document.createElement('div'); blk.className = 'org-block';
      blk.innerHTML = `<div class="org-hd" onclick="togOrg(this)"><div class="org-hd-l"><div class="org-stripe" style="background:${sc}"></div><div><div class="org-nm">${esc(o.orgName)}</div><div class="org-role">${o.role ? esc(o.role) + ' · ' : ''}${esc(o.totalPct || '—')} attendance</div></div></div><div class="org-hd-r"><div class="org-hrs-pill">${o.totalHrs} hrs</div><div class="org-chevron">▾</div></div></div><div class="org-body">${sessHtml}</div>`;
      stack.appendChild(blk);
    });
  }
  show('pgStudent');
}

window.togOrg = h => { const b = h.nextElementSibling, c = h.querySelector('.org-chevron'), o = b.classList.toggle('open'); c.style.transform = o ? 'rotate(180deg)' : ''; };
window.togDesc = id => { const d = el(id); if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none'; };

// ── FLAGS ─────────────────────────────────────────────────────
window.openFlag = (org, session, hrs) => {
  el('flagCtx').innerHTML = `<strong>${esc(org)}</strong> · ${esc(session)} · ${hrs} hrs`;
  el('flagTxt').value = '';
  el('flagTxt').dataset.org = org;
  el('flagTxt').dataset.session = session;
  openModal('mFlag');
};
window.doFlag = async () => {
  const c = el('flagTxt').value.trim();
  if (!c) { toast('Describe the issue', 'err'); return; }
  try {
    await submitFlag(S.email, el('flagTxt').dataset.org, el('flagTxt').dataset.session, c);
    closeModal('mFlag'); toast('Flag submitted', 'ok');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── VIEW AS ───────────────────────────────────────────────────
let VA_TIMER = null;
window.vaSearchDebounce = () => { clearTimeout(VA_TIMER); VA_TIMER = setTimeout(doVaSearch, 250); };
async function doVaSearch() {
  const q = (el('vaSearch').value || '').trim();
  const res = el('vaResults');
  if (q.length < 2) { res.style.display = 'none'; return; }
  try {
    const students = await searchStudents(q);
    if (!students.length) { res.style.display = 'none'; return; }
    res.innerHTML = students.map(s => `<div class="va-item" data-email="${esc(s.email || '')}" onclick="doViewAs(this)"><div class="va-name">${esc(s.lastName)}, ${esc(s.firstName)}</div><div class="va-meta">${esc(s.class_)} · ${esc(s.id)}</div></div>`).join('');
    res.style.display = 'block';
  } catch {}
}
window.doViewAs = async item => {
  const email = item.dataset.email;
  el('vaResults').style.display = 'none';
  el('vaSearch').value = item.querySelector('.va-name').textContent;
  show('pgLoad');
  try {
    const d = await getStudentData(email);
    S.asStu = email;
    renderStudent(d);
    el('vaBar').style.display = 'flex';
    el('vaBarName').textContent = item.querySelector('.va-name').textContent;
    navActive('myhr');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};
window.exitViewAs = () => {
  S.asStu = null;
  el('vaBar').style.display = 'none';
  el('vaSearch').value = '';
  if (S.role === 'super_admin') { buildNav(NAV_ADMIN); show('pgAdmin'); el('viewDash').style.display = 'block'; navActive('dash'); }
  else { show('pgTeacher'); navActive('teach'); }
};

// ── TEACHER PAGE ──────────────────────────────────────────────
async function loadTeacher(orgId) {
  if (!orgId) return;
  S.currentOrgId = orgId;
  show('pgLoad');
  try {
    const d = await getOrgEditorData(orgId);
    S.teacherData = d;
    S.currentOrgName = d.orgName;
    el('tOrgName').textContent = d.orgName;
    el('tMeta').textContent = `${d.students.length} students · ${d.dateCols.length} sessions logged`;
    el('tCnt').textContent = d.students.length + ' students';

    // Populate org selector for teachers with multiple orgs
    if (S.role === 'super_admin' || (S.role === 'teacher' && S.settings?.orgEditors)) {
      const orgs = await getOrgList();
      const sel = el('tOrgSel');
      sel.innerHTML = orgs.map(o => `<option value="${o.id}"${o.id == orgId ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
      sel.style.display = orgs.length > 1 ? 'block' : 'none';
    }

    const tb = el('tTbody'); tb.innerHTML = '';
    d.students.forEach(s => {
      const gc = GRADE_BG[s.grade] || '#f3f4f6', gt = GRADE_TC[s.grade] || '#374151';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="grade-pill" style="background:${gc};color:${gt}">${esc(s.grade || '—')}</span></td><td><strong>${esc(s.lastName)}</strong></td><td>${esc(s.firstName)}</td><td style="font-size:11px;color:var(--text2)">${esc(s.role || '—')}</td><td style="font-weight:600">${s.totalHrs} hrs</td><td>${esc(s.totalPct)}</td><td style="display:flex;gap:4px;white-space:nowrap"><button class="btn btn-s btn-sm" onclick="openSessDP(${JSON.stringify(s).split('"').join("'")})">Sessions</button><button class="del-btn btn-sm" onclick="confirmRemoveStu('${s.memberId}','${escJ(s.firstName + ' ' + s.lastName)}')">Remove</button></td>`;
      tb.appendChild(tr);
    });
    show('pgTeacher');
    navActive('teach');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.loadTeacher = loadTeacher;

window.openSessDP = s => {
  el('dpName').textContent = s.lastName + ', ' + s.firstName;
  el('dpMeta').textContent = s.grade + ' · ' + s.totalHrs + ' hrs';
  let html = '';
  if (!s.sessions || !s.sessions.length) {
    html = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No sessions yet</div></div>';
  } else {
    html = '<table class="sess-table"><thead><tr><th>Session</th><th>Date</th><th>Hrs</th><th></th></tr></thead><tbody>';
    s.sessions.forEach(sess => {
      html += `<tr><td style="font-size:11px;font-weight:500">${esc(sess.sessionName)}</td><td style="font-size:11px;color:var(--text2)">${esc(sess.date)}</td><td>${sess.hrs}</td><td><button class="del-btn" onclick="doDelSessHrs(${sess.sessionId},'${s.studentId}')">Clear</button></td></tr>`;
    });
    html += '</tbody></table>';
  }
  el('dpBody').innerHTML = html;
  el('dpBg').classList.add('open');
  el('dp').classList.add('open');
};

window.doDelSessHrs = async (sessionId, studentId) => {
  if (!confirm('Clear this student\'s hours for this session?')) return;
  try {
    await deleteSessionHours(sessionId, studentId);
    toast('Hours cleared', 'ok');
    closeDP();
    await loadTeacher(S.currentOrgId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

window.confirmRemoveStu = async (memberId, name) => {
  if (!confirm(`Remove ${name} from ${S.currentOrgName}?`)) return;
  try {
    await removeStudentFromOrg(memberId);
    toast(name + ' removed', 'ok');
    await loadTeacher(S.currentOrgId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── ADD SESSION ───────────────────────────────────────────────
function buildSessModal() {
  if (!S.teacherData) return;
  const now = new Date();
  el('sessDate').value = now.toISOString().split('T')[0];
  el('sessName').value = '';
  el('sessDesc').value = '';
  el('qfHrs').value = '1.5';
  el('scAll').checked = true;
  const rows = el('scRows'); rows.innerHTML = '';
  S.teacherData.students.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'sc-row';
    d.innerHTML = `<input type="checkbox" id="sc${i}" checked onchange="togSC(${i},this.checked)"/><label for="sc${i}" class="sc-name"><strong>${esc(s.lastName)}</strong>, ${esc(s.firstName)} <span style="font-size:10px;color:var(--text3)">(${esc(s.grade)})</span></label><input type="number" class="sc-hrs" id="sh${i}" value="1.5" min="0" max="24" step="0.5" data-sid="${s.studentId}"/>`;
    rows.appendChild(d);
  });
}
window.applyQF = () => { const v = el('qfHrs').value; document.querySelectorAll('.sc-hrs:not(:disabled)').forEach(i => i.value = v); };
window.togSC = (i, c) => { const inp = el('sh' + i); inp.disabled = !c; if (!c) inp.value = ''; else inp.value = el('qfHrs').value; };
window.toggleAll = c => { S.teacherData?.students.forEach((_, i) => { const cb = el('sc' + i); if (cb) { cb.checked = c; togSC(i, c); } }); };

window.doAddSess = async () => {
  const date = el('sessDate').value, name = el('sessName').value.trim(), desc = el('sessDesc').value.trim();
  if (!date || !name) { toast('Date and session name required', 'err'); return; }
  const entries = [];
  S.teacherData.students.forEach((s, i) => {
    const cb = el('sc' + i), inp = el('sh' + i);
    if (cb?.checked && inp && +inp.value > 0) entries.push({ studentId: s.studentId, hrs: +inp.value });
  });
  if (!entries.length) { toast('No students selected', 'err'); return; }
  toast('Saving session…', '');
  try {
    await addSession(S.currentOrgId, date, name, desc, entries);
    closeModal('mAddSess');
    toast(`✓ Session "${name}" saved`, 'ok');
    await loadTeacher(S.currentOrgId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── ADD STUDENT TO ORG ────────────────────────────────────────
let addStuTimer = null;
window.addStuSearchDebounce = () => { clearTimeout(addStuTimer); addStuTimer = setTimeout(doAddStuSearch, 250); };
async function doAddStuSearch() {
  const q = el('addStuSearch').value.trim();
  const res = el('addStuResults');
  if (q.length < 2) { res.classList.remove('open'); return; }
  const results = await searchStudents(q);
  if (!results.length) { res.innerHTML = '<div style="padding:8px 11px;font-size:11px;color:var(--text3)">No matches</div>'; res.classList.add('open'); return; }
  res.innerHTML = results.map(s => `<div class="stu-result-row" data-id="${esc(s.id)}" data-last="${esc(s.lastName)}" data-first="${esc(s.firstName)}" data-class="${esc(s.class_)}" onclick="selectAddStu(this)"><div class="stu-result-name">${esc(s.lastName)}, ${esc(s.firstName)}</div><div class="stu-result-meta">${esc(s.id)} · ${esc(s.class_)}</div></div>`).join('');
  res.classList.add('open');
}
window.selectAddStu = row => {
  S.addStu = { id: row.dataset.id, lastName: row.dataset.last, firstName: row.dataset.first, class_: row.dataset.class };
  el('addStuSearch').style.display = 'none';
  el('addStuResults').classList.remove('open');
  el('addStuSel').classList.add('show');
  el('addStuName').textContent = row.dataset.last + ', ' + row.dataset.first;
  el('addStuMeta').textContent = row.dataset.id + ' · ' + row.dataset.class;
};
window.clearAddStu = () => {
  S.addStu = null;
  el('addStuSearch').style.display = ''; el('addStuSearch').value = '';
  el('addStuSel').classList.remove('show');
  el('addStuResults').classList.remove('open'); el('addStuResults').innerHTML = '';
};
window.doAddStu = async () => {
  if (!S.addStu) { toast('Select a student first', 'err'); return; }
  const role = el('addStuRole').value.trim();
  try {
    const r = await addStudentToOrg(S.currentOrgId, S.addStu.id, role);
    if (!r.success) { toast(r.error, 'err'); return; }
    closeModal('mAddStu');
    toast(`✓ ${S.addStu.firstName} ${S.addStu.lastName} added`, 'ok');
    await loadTeacher(S.currentOrgId);
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── MISC HOURS ────────────────────────────────────────────────
let miscTimer = null;
window.miscStuDebounce = () => { clearTimeout(miscTimer); miscTimer = setTimeout(doMiscStuSearch, 250); };
async function doMiscStuSearch() {
  if (S.miscStu) return;
  const q = el('miscStuSearch').value.trim();
  const res = el('miscStuResults');
  if (q.length < 2) { res.classList.remove('open'); return; }
  const results = await searchStudents(q);
  if (!results.length) { res.innerHTML = '<div style="padding:8px 11px;font-size:11px;color:var(--text3)">No matches</div>'; res.classList.add('open'); return; }
  res.innerHTML = results.map(s => `<div class="stu-result-row" onclick="selectMiscStu(${JSON.stringify(s).split('"').join("'")})"><div class="stu-result-name">${esc(s.lastName)}, ${esc(s.firstName)}</div><div class="stu-result-meta">${esc(s.id)} · ${esc(s.class_)}</div></div>`).join('');
  res.classList.add('open');
}
window.selectMiscStu = s => {
  S.miscStu = s;
  el('miscStuSearch').style.display = 'none'; el('miscStuResults').classList.remove('open');
  el('miscStuSel').classList.add('show');
  el('miscStuName').textContent = s.lastName + ', ' + s.firstName;
  el('miscStuMeta').textContent = s.id + ' · ' + s.class_;
  el('miscManualRow').style.display = 'none';
};
window.clearMiscStu = () => {
  S.miscStu = null;
  el('miscStuSearch').style.display = ''; el('miscStuSearch').value = '';
  el('miscStuSel').classList.remove('show');
  el('miscStuResults').innerHTML = ''; el('miscStuResults').classList.remove('open');
  el('miscManualRow').style.display = 'grid';
};
window.doAddMisc = async () => {
  const task = el('miscTask').value.trim(), date = el('miscDate').value, hours = parseFloat(el('miscHours').value);
  if (!task || !date || !hours || hours <= 0) { toast('Task, date and hours required', 'err'); return; }
  let sl = '', sf = '', sid = '';
  if (S.miscStu) { sl = S.miscStu.lastName; sf = S.miscStu.firstName; sid = S.miscStu.id; }
  else { sl = el('miscManualLast').value.trim(); sf = el('miscManualFirst').value.trim(); }
  if (!sl || !sf) { toast('Student name required', 'err'); return; }
  try {
    await addMiscHours({ teacherEmail: S.email, teacherName: el('miscTeacherName').value.trim(), studentId: sid, studentLast: sl, studentFirst: sf, taskName: task, description: el('miscDesc').value.trim(), date, hours });
    closeModal('mAddMisc');
    toast(`✓ Hours saved for ${sf} ${sl}`, 'ok');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

function initMiscModal() {
  S.miscStu = null;
  el('miscStuSearch').style.display = ''; el('miscStuSearch').value = '';
  el('miscStuSel').classList.remove('show');
  el('miscStuResults').innerHTML = ''; el('miscStuResults').classList.remove('open');
  el('miscManualRow').style.display = 'grid';
  el('miscManualLast').value = ''; el('miscManualFirst').value = '';
  el('miscTask').value = ''; el('miscDesc').value = ''; el('miscHours').value = '1';
  el('miscDate').value = new Date().toISOString().split('T')[0];
  if (S.role === 'super_admin' || S.role === 'teacher') el('miscTeacherName').value = S.displayName || '';
}

// ── MISC ADMIN ────────────────────────────────────────────────
let MISC_DATA = [];
async function loadMiscAdmin() {
  try { MISC_DATA = await getMiscHours(); renderMiscAdmin(); } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.renderMiscAdmin = () => {
  const q = (el('miscSrch').value || '').toLowerCase();
  const rows = MISC_DATA.filter(e => !q || (e.studentLast + ' ' + e.studentFirst + ' ' + (e.teacherName || '') + ' ' + e.taskName).toLowerCase().includes(q));
  const tb = el('miscAdminTbody'); tb.innerHTML = '';
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:28px">No entries</td></tr>'; return; }
  rows.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-size:11px;color:var(--text2)">${esc(e.date)}</td><td style="font-size:11px">${esc(e.teacherName || e.teacherEmail)}</td><td><strong>${esc(e.studentLast)}</strong>, ${esc(e.studentFirst)}</td><td style="font-weight:500">${esc(e.taskName)}</td><td style="font-size:11px;color:var(--text2)">${esc(e.description || '—')}</td><td>${e.hours} hrs</td><td><button class="del-btn btn-sm" data-id="${e.id}" onclick="doDelMiscAdmin(this.dataset.id)">Delete</button></td>`;
    tb.appendChild(tr);
  });
};
window.doDelMiscAdmin = async id => {
  if (!confirm('Delete this entry?')) return;
  try { await deleteMiscHours(id); toast('Deleted', 'ok'); await loadMiscAdmin(); } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── ADMIN ─────────────────────────────────────────────────────
async function loadAdmin() {
  show('pgLoad');
  try {
    const d = await getAdminSummary();
    S.adminData = d;
    el('sbSY').textContent = d.activeSY;
    el('sbSync').textContent = 'Synced ' + d.lastSync;
    el('dashSub').textContent = 'Overview of service hours — ' + d.activeSY;

    el('adminStats').innerHTML =
      mkStat(d.stats.total, 'Total Students', 'blue') +
      mkStat(d.stats.avgHrs, 'Avg Hours This Year', 'amber') +
      mkStat(d.orgs.length, 'Organizations', 'purple') +
      mkStat(d.stats.totalSessions, 'Total Sessions', '');

    renderAdminTbl();
    buildCharts(d);
    renderOrgGrid();
    show('pgAdmin');
    el('viewDash').style.display = 'block';
    navActive('dash');

    // Load roster in background
    getMasterRoster().then(r => { S.rosterData = r; }).catch(() => {});
  } catch (e) { toast('Error loading admin data: ' + e.message, 'err'); }
}

function mkStat(n, l, c) { return `<div class="stat-card"><div class="stat-card-label">${l}</div><div class="stat-n ${c}">${n}</div></div>`; }

// ── ADMIN TABLE ───────────────────────────────────────────────
window.sortAdminTbl = col => { if (S.adminSort.col === col) S.adminSort.dir *= -1; else { S.adminSort.col = col; S.adminSort.dir = 1; } renderAdminTbl(); };
window.renderAdminTbl = () => {
  if (!S.adminData) return;
  let rows = S.adminData.students.slice();
  const q = (el('srch')?.value || '').toLowerCase();
  const fg = el('fGr')?.value, fh = el('fHse')?.value;
  rows = rows.filter(s => {
    if (q && !(s.id + ' ' + s.lastName + ' ' + s.firstName + ' ' + (s.email || '')).toLowerCase().includes(q)) return false;
    if (fg && s.class_ !== fg) return false;
    if (fh && s.house !== fh) return false;
    return true;
  });
  const dir = S.adminSort.dir;
  rows.sort((a, b) => {
    if (S.adminSort.col === 'name') return dir * a.lastName.localeCompare(b.lastName);
    if (S.adminSort.col === 'class') return dir * (gradeRank(a.class_) - gradeRank(b.class_));
    if (S.adminSort.col === 'hrs') return dir * (a.currentHrs - b.currentHrs);
    if (S.adminSort.col === 'cumul') return dir * (a.cumulHrs - b.cumulHrs);
    return 0;
  });
  ['name','class','hrs','cumul'].forEach(c => { const e = el('srt-' + c); if (e) e.textContent = S.adminSort.col === c ? (S.adminSort.dir === 1 ? '↑' : '↓') : ''; });
  const tb = el('adminTbody'); tb.innerHTML = '';
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:28px">No students match</td></tr>'; return; }
  rows.forEach(s => {
    const gc = GRADE_BG[s.class_] || '#f3f4f6', gt = GRADE_TC[s.class_] || '#374151';
    const hc = HOUSE_COLORS[s.house];
    const tr = document.createElement('tr');
    tr.onclick = () => openDP(s);
    tr.innerHTML = `<td><strong>${esc(s.lastName)}</strong>, ${esc(s.firstName)}</td><td style="font-family:monospace;font-size:11px;color:var(--text3)">${esc(s.id || '—')}</td><td><span class="grade-pill" style="background:${gc};color:${gt}">${esc(s.class_ || '—')}</span></td><td>${hc ? `<span class="house-pill" style="background:${hc}22;color:${hc}">${esc(s.house)}</span>` : '—'}</td><td style="font-size:11px;color:var(--text2)">${esc(s.email || '—')}</td><td style="font-weight:600">${s.currentHrs} hrs</td><td style="font-size:11px;font-weight:600">${s.cumulHrs} hrs</td>`;
    tb.appendChild(tr);
  });
};

// ── ROSTER ────────────────────────────────────────────────────
window.renderRoster = () => {
  if (!S.rosterData) return;
  let rows = S.rosterData.students.slice();
  const q = (el('rSrch')?.value || '').toLowerCase();
  const rs = el('rStatus')?.value, rg = el('rGr')?.value, rh = el('rHse')?.value;
  rows = rows.filter(s => {
    if (q && !(s.id + ' ' + s.lastName + ' ' + s.firstName + ' ' + s.email).toLowerCase().includes(q)) return false;
    if (rs && s.status !== rs) return false;
    if (rg && s.class_ !== rg) return false;
    if (rh && s.house !== rh) return false;
    return true;
  });
  const tb = el('rTbody'); tb.innerHTML = '';
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:28px">No students</td></tr>'; return; }
  rows.forEach(s => {
    const gc = GRADE_BG[s.class_] || '#f3f4f6', gt = GRADE_TC[s.class_] || '#374151';
    const hc = HOUSE_COLORS[s.house];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-family:monospace;font-size:11px;color:var(--text3)">${esc(s.id)}</td><td><strong>${esc(s.lastName)}</strong></td><td>${esc(s.firstName)}</td><td><span class="grade-pill" style="background:${gc};color:${gt}">${esc(s.class_ || '—')}</span></td><td>${hc ? `<span class="house-pill" style="background:${hc}22;color:${hc}">${esc(s.house)}</span>` : '—'}</td><td style="font-size:11px;color:var(--text2)">${esc(s.email)}</td><td style="font-size:11px;font-weight:600">${s.currentSYHrs > 0 ? s.currentSYHrs + ' hrs' : '<span style="color:var(--text3)">0</span>'}</td><td style="font-size:11px;font-weight:600">${s.cumulHrs} hrs</td><td><span class="status-${s.status.toLowerCase()}">${s.status}</span></td><td><button class="btn btn-s btn-sm" data-id="${esc(s.id)}" data-last="${esc(s.lastName)}" data-first="${esc(s.firstName)}" data-class="${esc(s.class_)}" data-house="${esc(s.house || '')}" data-status="${esc(s.status)}" onclick="openEditStu(this)">Edit</button></td>`;
    tb.appendChild(tr);
  });
};

window.openEditStu = btn => {
  el('editStuId').value = btn.dataset.id;
  el('eId').value = btn.dataset.id; updateEditEmailPreview();
  el('eLast').value = btn.dataset.last; el('eFirst').value = btn.dataset.first;
  el('eClass').value = btn.dataset.class; el('eHouse').value = btn.dataset.house;
  el('eStatus').value = btn.dataset.status;
  openModal('mEditStu');
};
window.updateEditEmailPreview = () => { const id = el('eId').value.trim(); el('eEmailPrev').textContent = id ? 'Email: ' + id.replace(/-/g,'') + '@dishs.tp.edu.tw' : '—'; };
window.doEditStu = async () => {
  const origId = el('editStuId').value;
  const info = { id: el('eId').value.trim(), lastName: el('eLast').value.toUpperCase(), firstName: el('eFirst').value, class_: el('eClass').value, house: el('eHouse').value, status: el('eStatus').value };
  try {
    await updateStudent(origId, info);
    closeModal('mEditStu'); toast('✓ Saved', 'ok');
    const r = await getMasterRoster(); S.rosterData = r; renderRoster();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};
window.doDeleteStu = async () => {
  const id = el('editStuId').value, name = el('eLast').value + ', ' + el('eFirst').value;
  if (!confirm(`Permanently delete ${name}?\n\nThis removes them from all org tabs too.`)) return;
  try {
    await deleteStudentFromRoster(id);
    closeModal('mEditStu'); toast(`✓ ${name} deleted`, 'ok');
    const r = await getMasterRoster(); S.rosterData = r; renderRoster();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

window.previewNewStu = () => { const id = el('nId').value.trim(); el('nEmailPrev').textContent = 'Email: ' + (id ? id.replace(/-/g,'') + '@dishs.tp.edu.tw' : '—'); };
window.doNewStu = async () => {
  const info = { id: el('nId').value.trim(), lastName: el('nLast').value.trim().toUpperCase(), firstName: el('nFirst').value.trim(), class_: el('nClass').value, house: el('nHouse').value };
  if (!info.id || !info.lastName || !info.firstName || !info.class_) { toast('ID, name and class required', 'err'); return; }
  try {
    const r = await addStudentToRoster(info);
    closeModal('mNewStu'); toast('Added: ' + r.email, 'ok');
    const rd = await getMasterRoster(); S.rosterData = rd;
    if (el('viewRoster').style.display !== 'none') renderRoster();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
};

window.doBulk = async () => {
  const txt = el('bulkTxt').value.trim();
  if (!txt) { toast('Paste data first', 'err'); return; }
  const res = el('importResult'); res.style.display = 'block'; res.innerHTML = '<div>Importing…</div>';
  try {
    const r = await bulkImportStudents(txt);
    let html = `<strong style="color:var(--green)">✓ Added: ${r.added}</strong>`;
    if (r.skipped.length) html += `<br><span style="color:var(--amber)">⚠ Skipped: ${r.skipped.length}</span>`;
    if (r.errors.length) html += `<br><span style="color:var(--red)">Errors: ${r.errors.join('; ')}</span>`;
    res.innerHTML = html;
    toast('Import done — ' + r.added + ' added', 'ok');
    if (r.added > 0) { const rd = await getMasterRoster(); S.rosterData = rd; if (el('viewRoster').style.display !== 'none') renderRoster(); }
  } catch (e) { res.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`; toast('Import failed', 'err'); }
};

// ── ORG GRID ──────────────────────────────────────────────────
async function renderOrgGrid() {
  if (!S.adminData) return;
  const og = el('orgGrid'); og.innerHTML = '';
  S.adminData.orgs.forEach(o => {
    const stats = S.adminData.orgStats[o.name] || {};
    og.innerHTML += `<div class="card" style="margin-bottom:0"><div style="height:3px;background:${orgColor(o.name)}"></div><div class="card-b"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:5px"><div style="font-weight:600;font-size:13px;cursor:pointer" onclick="goTeacherOrg(${o.id})">${esc(o.name)}</div><button class="btn btn-d btn-sm" onclick="doDeleteOrg(${o.id},'${escJ(o.name)}')">Delete</button></div><div style="font-size:20px;font-weight:700;cursor:pointer" onclick="goTeacherOrg(${o.id})">${stats.count || 0}<span style="font-size:12px;font-weight:400;color:var(--text2)"> students</span></div><div style="font-size:11px;color:var(--text2);margin-top:3px">${stats.totalHrs || 0} hrs · ${stats.sessions || 0} sessions</div></div></div>`;
  });
}
window.goTeacherOrg = id => { buildNav(NAV_TEACHER); show('pgTeacher'); loadTeacher(id); };

window.doNewOrg = async () => {
  const name = el('newOrgName').value.trim();
  if (!name) { toast('Enter organization name', 'err'); return; }
  try { await createOrg(name); closeModal('mNewOrg'); toast('✓ Created: ' + name, 'ok'); await loadAdmin(); } catch (e) { toast('Error: ' + e.message, 'err'); }
};
window.doDeleteOrg = async (id, name) => {
  if (!confirm(`Delete organization "${name}"?\nSessions and hours will be preserved but the org will be hidden.`)) return;
  try { await deleteOrg(id); toast('"' + name + '" deleted', 'ok'); await loadAdmin(); } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── DETAIL PANEL ──────────────────────────────────────────────
function openDP(s) {
  el('dpName').textContent = s.firstName + ' ' + s.lastName;
  const gc = GRADE_BG[s.class_] || '#e5e7eb', gt = GRADE_TC[s.class_] || '#374151';
  const hc = HOUSE_COLORS[s.house];
  let html = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><span class="grade-pill" style="background:${gc};color:${gt}">${esc(s.class_ || '—')}</span>${hc ? `<span class="house-pill" style="background:${hc}22;color:${hc}">${esc(s.house)}</span>` : ''}<span style="padding:2px 8px;border-radius:5px;font-size:11px;font-weight:600;background:var(--accent-light);color:var(--accent)">${s.currentHrs} hrs this year</span><span style="padding:2px 8px;border-radius:5px;font-size:11px;background:var(--bg3);color:var(--text2);border:1px solid var(--border)">${s.cumulHrs} cumulative</span></div>`;
  const sk = Object.keys(s.syHrs || {}).sort();
  if (sk.length) {
    const mx = Math.max(...sk.map(k => s.syHrs[k] || 0)) || 1;
    html += '<div style="margin-bottom:14px"><div style="font-size:9.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Year History</div><div class="sy-hist">' + sk.map(sy => { const h = s.syHrs[sy] || 0; return `<div class="sy-row"><div class="sy-lbl">${esc(sy)}</div><div class="sy-bar-bg"><div class="sy-bar-fg" style="width:${Math.round(h/mx*100)}%"></div></div><div class="sy-num">${h} hrs</div></div>`; }).join('') + '</div></div>';
  }
  el('dpBody').innerHTML = html;
  el('dpMeta').textContent = (s.class_ || '') + (s.id ? ' · ' + s.id : '') + (s.email ? ' · ' + s.email : '');
  el('dpBg').classList.add('open'); el('dp').classList.add('open');
}
window.closeDP = () => { el('dpBg').classList.remove('open'); el('dp').classList.remove('open'); };

// ── FLAGS PAGE ────────────────────────────────────────────────
async function loadFlags() {
  try {
    const flags = await getFlags();
    const pending = flags.filter(f => f.status === 'Pending');
    const b = el('fBadge'); if (b) { b.textContent = pending.length; b.style.display = pending.length ? '' : 'none'; }
    const wrap = el('flagsList');
    if (!flags.length) { wrap.innerHTML = '<div class="empty"><div class="empty-icon">✓</div><div class="empty-title">No flags</div></div>'; return; }
    wrap.innerHTML = flags.map(f => {
      const stBadge = f.status === 'Pending' ? 'badge-pend' : f.status === 'Resolved' ? 'badge-resolved' : 'badge-dismissed';
      return `<div class="card" style="margin-bottom:9px"><div class="card-b" style="display:flex;gap:11px;justify-content:space-between"><div style="flex:1"><div style="font-weight:600;font-size:12px">${esc(f.email)}</div><div style="font-size:11px;color:var(--text2);margin-top:1px">${esc(f.orgName || '—')} · ${esc(f.sessionDate || '—')}</div><div style="font-size:12px;margin-top:6px;background:var(--bg3);padding:7px 10px;border-radius:var(--r-sm);border:1px solid var(--border)">${esc(f.comment)}</div>${f.resolution ? `<div style="font-size:11px;color:var(--green);margin-top:4px;font-style:italic">Resolution: ${esc(f.resolution)}</div>` : ''}<div style="font-size:10px;color:var(--text3);margin-top:3px">${esc(f.timestamp)}</div></div><div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:flex-end"><span class="${stBadge}">${esc(f.status)}</span>${f.status === 'Pending' ? `<button class="btn btn-ok btn-sm" onclick="doResolveFlag('${f.id}','Resolved')">Resolve</button><button class="btn btn-s btn-sm" onclick="doResolveFlag('${f.id}','Dismissed')">Dismiss</button>` : ''}<button class="btn btn-d btn-sm" onclick="doDeleteFlag('${f.id}')">Delete</button></div></div></div>`;
    }).join('');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.doResolveFlag = async (id, status) => { try { await resolveFlag(id, status); toast('Flag ' + status, 'ok'); loadFlags(); } catch (e) { toast('Error: ' + e.message, 'err'); } };
window.doDeleteFlag = async id => { if (!confirm('Delete this flag?')) return; try { await deleteFlag(id); toast('Deleted', 'ok'); loadFlags(); } catch (e) { toast('Error: ' + e.message, 'err'); } };

// ── OFF-CAMPUS ────────────────────────────────────────────────
async function loadOC() {
  try {
    const items = await getOffCampusPending();
    const b = el('ocBadge'); if (b) { b.textContent = items.length; b.style.display = items.length ? '' : 'none'; }
    const wrap = el('ocList');
    if (!items.length) { wrap.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">No pending submissions</div></div>'; return; }
    wrap.innerHTML = items.map(r => `<div class="card"><div class="card-b" style="display:flex;gap:11px;justify-content:space-between"><div style="flex:1"><div style="font-weight:600;font-size:12px">${esc(r.studentEmail)}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(r.orgName)} · ${esc(r.eventDate)} · <strong>${r.hours} hrs</strong></div>${r.description ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">${esc(r.description)}</div>` : ''}<div style="font-size:10px;color:var(--text3);margin-top:3px">Supervisor: ${esc(r.supervisorName)} · ${r.timestamp}</div></div><div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0"><button class="btn btn-ok btn-sm" onclick="doOC('${r.id}','Approved')">Approve</button><button class="btn btn-d btn-sm" onclick="doOC('${r.id}','Rejected')">Reject</button></div></div></div>`).join('');
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.doOC = async (id, status) => { try { await updateOffCampusStatus(id, status); toast(status, 'ok'); loadOC(); } catch (e) { toast('Error: ' + e.message, 'err'); } };
window.doSubmitOffCampus = async () => {
  const org = el('ocOrgName').value.trim(), date = el('ocDate').value, hours = parseFloat(el('ocHours').value), desc = el('ocDesc').value.trim(), supName = el('ocSupName').value.trim(), supEmail = el('ocSupEmail').value.trim();
  if (!org || !date || !hours || !desc || !supName || !supEmail) { toast('All fields required', 'err'); return; }
  try { await submitOffCampus(S.email, { orgName: org, eventDate: date, hours, description: desc, supervisorName: supName, supervisorEmail: supEmail }); closeModal('mOffCampus'); toast('Submitted! Admin will review.', 'ok'); } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── SETTINGS ─────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await getSettings();
    S.settings = cfg;
    el('activeSYLbl').textContent = cfg.activeSY;
    const sl = el('saList'); sl.innerHTML = '';
    cfg.superAdmins.forEach(e => { const row = document.createElement('div'); row.className = 'email-row'; row.innerHTML = `<span>${esc(e)}</span><button class="btn btn-d btn-sm" onclick="removeSA('${escJ(e)}')">Remove</button>`; sl.appendChild(row); });
    const ob = el('oeBlocks'); ob.innerHTML = '';
    cfg.orgs.forEach(org => {
      const eds = cfg.orgEditors[org] || [], sid = org.replace(/[^a-zA-Z0-9]/g, '_');
      const div = document.createElement('div'); div.className = 'oe-block';
      div.innerHTML = `<div class="oe-name">${esc(org)}</div>${eds.map(e => `<div class="email-row" style="margin-bottom:3px"><span>${esc(e)}</span><button class="btn btn-d btn-sm" onclick="removeOE('${escJ(org)}','${escJ(e)}')">Remove</button></div>`).join('') || '<div style="font-size:11px;color:var(--text3);margin-bottom:5px">No teachers assigned</div>'}<div class="add-row"><input type="text" placeholder="Add teacher email…" id="oe_${sid}"/><button class="btn btn-p btn-sm" onclick="addOE('${escJ(org)}','${sid}')">+ Add</button></div>`;
      ob.appendChild(div);
    });
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}
window.addSA = async () => { const e = prompt('Super admin email:'); if (!e) return; S.settings.superAdmins.push(e.trim().toLowerCase()); try { await saveSuperAdmins(S.settings.superAdmins); loadSettings(); toast('Added', 'ok'); } catch (err) { toast('Error: ' + err.message, 'err'); } };
window.removeSA = async e => { if (!confirm('Remove ' + e + '?')) return; S.settings.superAdmins = S.settings.superAdmins.filter(x => x !== e); try { await saveSuperAdmins(S.settings.superAdmins); loadSettings(); toast('Removed', 'ok'); } catch (err) { toast('Error: ' + err.message, 'err'); } };
window.addOE = async (org, sid) => { const inp = el('oe_' + sid); if (!inp?.value.trim()) { toast('Enter email', 'err'); return; } const email = inp.value.trim().toLowerCase(); if (!S.settings.orgEditors[org]) S.settings.orgEditors[org] = []; if (S.settings.orgEditors[org].includes(email)) { toast('Already added', 'warn'); return; } S.settings.orgEditors[org].push(email); try { await saveOrgEditors(S.settings.orgEditors); loadSettings(); toast('Teacher added to ' + org, 'ok'); } catch (err) { toast('Error: ' + err.message, 'err'); } };
window.removeOE = async (org, email) => { S.settings.orgEditors[org] = (S.settings.orgEditors[org] || []).filter(e => e !== email); try { await saveOrgEditors(S.settings.orgEditors); loadSettings(); toast('Removed', 'ok'); } catch (err) { toast('Error: ' + err.message, 'err'); } };

window.doAddTeacher = async () => {
  const email = el('atEmail').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { toast('Enter valid email', 'err'); return; }
  const orgs = Array.from(document.querySelectorAll('#atOrgList input[type=checkbox]:checked')).map(cb => cb.nextElementSibling.textContent.trim());
  if (!orgs.length) { toast('Assign at least one organization', 'err'); return; }
  if (!S.settings.orgEditors) S.settings.orgEditors = {};
  orgs.forEach(org => { if (!S.settings.orgEditors[org]) S.settings.orgEditors[org] = []; if (!S.settings.orgEditors[org].includes(email)) S.settings.orgEditors[org].push(email); });
  try { await saveOrgEditors(S.settings.orgEditors); closeModal('mAddTeacher'); toast(email + ' added to: ' + orgs.join(', '), 'ok'); loadSettings(); } catch (e) { toast('Error: ' + e.message, 'err'); }
};

async function loadNYOrgs() {
  const orgs = await getOrgList();
  const list = el('nyOrgList'); list.innerHTML = '';
  orgs.forEach(o => { const row = document.createElement('div'); row.className = 'org-check-row'; row.innerHTML = `<input type="checkbox" id="nyo_${o.id}" value="${o.id}" checked/><label for="nyo_${o.id}">${esc(o.name)}</label>`; list.appendChild(row); });
}
window.doNewSY = async () => {
  const sy = el('nySY').value.trim(), conf = el('nyConf').value.trim();
  if (conf !== 'CONFIRM') { toast('Type CONFIRM to proceed', 'err'); return; }
  if (!sy || !/^SY\d{4}-\d{2}$/.test(sy)) { toast('Valid SY code required (e.g. SY2027-28)', 'err'); return; }
  const orgIds = Array.from(document.querySelectorAll('#nyOrgList input[type=checkbox]:checked')).map(cb => cb.value);
  toast('Starting new school year… please wait', 'warn');
  try { const r = await startNewSchoolYear(sy, orgIds); closeModal('mNewSY'); toast('New year ' + r.newSY + ' started!', 'ok'); setTimeout(() => loadAdmin(), 1500); } catch (e) { toast('Error: ' + e.message, 'err'); }
};

// ── CHARTS ────────────────────────────────────────────────────
function mkChart(id, type, labels, data, colors, opts = {}) {
  destroyChart(id);
  const ctx = el(id)?.getContext('2d'); if (!ctx) return;
  CHARTS[id] = new Chart(ctx, { type, data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: type === 'line' ? colors[0] : colors, borderWidth: type === 'line' ? 2 : 0, tension: .35, fill: type === 'line', pointRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === 'doughnut' || type === 'pie', position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'DM Sans' } } }, tooltip: { callbacks: { label: c => ' ' + c.formattedValue + (opts.pct ? '%' : ' hrs') } } }, scales: type !== 'doughnut' && type !== 'pie' ? { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10, family: 'DM Sans' }, color: '#999' } }, x: { grid: { display: false }, ticks: { font: { size: 10, family: 'DM Sans' }, color: '#999', maxRotation: 30 } } } : {} } });
}
function destroyChart(id) { if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; } }
function buildCharts(d) {
  const on = d.orgs.map(o => o.name);
  mkChart('cOrg', 'bar', on, on.map(n => d.orgStats[n]?.totalHrs || 0), CC, { xl: 'Organization', yl: 'Total Hours' });
  const gs = Object.keys(d.gradeHrs).sort((a, b) => gradeRank(a) - gradeRank(b));
  mkChart('cGrade', 'bar', gs, gs.map(g => d.gradeHrs[g].count ? Math.round(d.gradeHrs[g].totalHrs / d.gradeHrs[g].count * 10) / 10 : 0), gs.map(g => GRADE_BG[g] || '#e5e7eb'), { xl: 'Grade', yl: 'Avg Hours' });
  const ms = Object.keys(d.monthly).sort();
  mkChart('cMonth', 'line', ms.map(m => { const p = m.split('-'); return p[1] + '/' + p[0].slice(2); }), ms.map(m => d.monthly[m]), [CC[0]], { xl: 'Month', yl: 'Sessions' });
  const top = d.topStudents || [];
  mkChart('cTop', 'bar', top.map(s => { const nm = s.name.split(' '); return nm[0][0] + '. ' + nm[nm.length - 1]; }), top.map(s => s.hrs), CC, { xl: 'Student', yl: 'Hours' });
}

// ── MODALS ────────────────────────────────────────────────────
window.openModal = id => {
  if (id === 'mAddSess') buildSessModal();
  if (id === 'mAddMisc') initMiscModal();
  if (id === 'mAddStu') { S.addStu = null; el('addStuSearch').value = ''; el('addStuSearch').style.display = ''; el('addStuSel').classList.remove('show'); el('addStuResults').innerHTML = ''; el('addStuRole').value = ''; }
  if (id === 'mNewSY') loadNYOrgs();
  if (id === 'mAddTeacher') { el('atEmail').value = ''; const list = el('atOrgList'); list.innerHTML = ''; (S.settings?.orgs || []).forEach(org => { const row = document.createElement('div'); row.className = 'org-check-row'; row.innerHTML = `<input type="checkbox" id="at_${esc(org)}"/><label for="at_${esc(org)}">${esc(org)}</label>`; list.appendChild(row); }); }
  if (id === 'mOffCampus') { el('ocDate').value = new Date().toISOString().split('T')[0]; ['ocOrgName','ocDesc','ocSupName','ocSupEmail'].forEach(i => { const e = el(i); if (e) e.value = ''; }); el('ocHours').value = '1'; }
  el(id).classList.add('open');
};
window.closeModal = id => el(id).classList.remove('open');

// ── HELPERS ───────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function show(id) { document.querySelectorAll('.page').forEach(p => p.classList.remove('show')); el(id).classList.add('show'); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJ(s) { return String(s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function toast(msg, type) { const t = el('toast'); t.textContent = msg; t.className = 'toast show' + (type ? ' ' + type : ''); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3800); }
function gradeRank(g) { return GRADE_ORDER.indexOf(g); }

// Hash-based org color — consistent, no hardcoded names
function orgColor(name) {
  if (!name) return '#6b7280';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue},55%,45%)`;
}