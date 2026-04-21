// ============================================================
// db.js — All database operations (replaces Google Apps Script)
// ============================================================
import { supabase } from './supabase.js';

// ── HELPERS ───────────────────────────────────────────────────
export function idToEmail(id) {
  return String(id).replace(/-/g, '').replace(/\s/g, '') + '@dishs.tp.edu.tw';
}

function getActiveSYSync() {
  const cached = sessionStorage.getItem('active_sy');
  if (cached) return cached;
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
  return m >= 8 ? `SY${y}-${String(y + 1).slice(2)}` : `SY${y - 1}-${String(y).slice(2)}`;
}

export async function getActiveSY() {
  const sy = await getConfig('active_sy', getActiveSYSync());
  sessionStorage.setItem('active_sy', sy);
  return sy;
}

// ── CONFIG ────────────────────────────────────────────────────
export async function getConfig(key, defaultVal = null) {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .single();
  if (!data) return defaultVal;
  try { return JSON.parse(data.value); } catch { return data.value; }
}

export async function setConfig(key, value) {
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' });
  if (error) throw error;
}

// ── MASTER ROSTER ─────────────────────────────────────────────
export async function getMasterRoster() {
  const sy = await getActiveSY();

  const { data: students, error } = await supabase
    .from('students')
    .select(`
      *,
      sy_hours ( school_year, hours )
    `)
    .order('last_name');

  if (error) throw error;

  // Attach current SY hours from attendance + misc
  const currentHrsMap = await getCurrentSYHoursMap(sy);

  return {
    students: students.map(s => ({
      id: s.id,
      lastName: s.last_name,
      firstName: s.first_name,
      class_: s.class,
      house: s.house,
      email: s.email,
      status: s.status,
      joined: s.sy_joined,
      cumulHrs: s.cumulative_hrs ?? 0,
      currentSYHrs: currentHrsMap[s.id] ?? 0,
      syHrs: Object.fromEntries((s.sy_hours ?? []).map(r => [r.school_year, r.hours])),
      rowIndex: s.id, // use ID as row reference (not a row number anymore)
    })),
    activeSY: sy,
  };
}

// Sum of attendance + misc hours for every student this SY
async function getCurrentSYHoursMap(sy) {
  // Attendance hours
  const { data: att } = await supabase
    .from('attendance')
    .select(`
      hours,
      student_id,
      sessions!inner ( school_year )
    `)
    .eq('sessions.school_year', sy);

  // Misc hours
  const { data: misc } = await supabase
    .from('misc_hours')
    .select('student_id, student_last, student_first, hours')
    .eq('school_year', sy);

  const map = {};
  (att ?? []).forEach(r => {
    map[r.student_id] = (map[r.student_id] ?? 0) + (r.hours ?? 0);
  });
  (misc ?? []).forEach(r => {
    if (r.student_id) {
      map[r.student_id] = (map[r.student_id] ?? 0) + (r.hours ?? 0);
    }
  });
  return map;
}

export async function addStudentToRoster(info) {
  const email = idToEmail(info.id);
  const sy = await getActiveSY();
  const { error } = await supabase.from('students').insert({
    id: info.id,
    last_name: info.lastName.toUpperCase(),
    first_name: info.firstName,
    class: info.class_,
    house: info.house ?? '',
    email,
    status: 'Active',
    sy_joined: sy,
    cumulative_hrs: 0,
  });
  if (error) throw new Error(error.message);
  return { success: true, email };
}

export async function bulkImportStudents(pastedText) {
  const sy = await getActiveSY();
  const lines = pastedText.trim().split('\n');
  let added = 0;
  const skipped = [], errors = [];

  // Fetch existing IDs once
  const { data: existing } = await supabase.from('students').select('id');
  const existingIds = new Set((existing ?? []).map(r => r.id));

  const rows = [];
  lines.forEach((line, i) => {
    const cols = line.split('\t');
    if (cols.length < 3) { if (line.trim()) errors.push(`Row ${i + 1}: need at least 3 columns`); return; }
    const id = cols[0]?.trim(), last = cols[1]?.trim(), first = cols[2]?.trim();
    const cls = cols[3]?.trim() ?? '', house = cols[4]?.trim() ?? '';
    if (!id || !last || !first) { errors.push(`Row ${i + 1}: missing ID or name`); return; }
    if (existingIds.has(id)) { skipped.push(`${id} (${last}, ${first})`); return; }
    rows.push({ id, last_name: last.toUpperCase(), first_name: first, class: cls, house, email: idToEmail(id), status: 'Active', sy_joined: sy, cumulative_hrs: 0 });
    existingIds.add(id);
    added++;
  });

  if (rows.length) {
    const { error } = await supabase.from('students').insert(rows);
    if (error) throw new Error(error.message);
  }
  return { success: true, added, skipped, errors };
}

export async function updateStudent(id, info) {
  const updates = {};
  if (info.lastName) updates.last_name = info.lastName.toUpperCase();
  if (info.firstName) updates.first_name = info.firstName;
  if (info.class_) updates.class = info.class_;
  if (info.house) updates.house = info.house;
  if (info.status) updates.status = info.status;
  if (info.id && info.id !== id) {
    updates.id = info.id;
    updates.email = idToEmail(info.id);
  }
  const { error } = await supabase.from('students').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteStudentFromRoster(studentId) {
  // Cascades delete org_members, attendance, sy_hours via FK
  const { error } = await supabase.from('students').delete().eq('id', studentId);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function findStudentByEmail(email) {
  const { data } = await supabase.from('students').select('id').eq('email', email.toLowerCase()).single();
  return data ?? null;
}

export async function searchStudents(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const { data } = await supabase
    .from('students')
    .select('id, last_name, first_name, class, house')
    .or(`last_name.ilike.%${q}%,first_name.ilike.%${q}%,id.ilike.%${q}%`)
    .eq('status', 'Active')
    .limit(12);
  return (data ?? []).map(s => ({
    id: s.id,
    lastName: s.last_name,
    firstName: s.first_name,
    class_: s.class,
    house: s.house,
  }));
}

// ── ORGANIZATIONS ─────────────────────────────────────────────
export async function getOrgList() {
  const sy = await getActiveSY();
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('school_year', sy)
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map(o => ({ id: o.id, name: o.name }));
}

export async function createOrg(name) {
  const sy = await getActiveSY();
  const { error } = await supabase.from('organizations').insert({ name, school_year: sy, active: true });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteOrg(orgId) {
  // Soft delete — keeps historical data
  const { error } = await supabase.from('organizations').update({ active: false }).eq('id', orgId);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function renameOrg(orgId, newName) {
  const { error } = await supabase.from('organizations').update({ name: newName }).eq('id', orgId);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── ORG EDITOR DATA (for teacher view) ───────────────────────
export async function getOrgEditorData(orgId) {
  const sy = await getActiveSY();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single();

  const { data: members } = await supabase
    .from('org_members')
    .select(`
      id,
      role,
      students ( id, last_name, first_name, class, house )
    `)
    .eq('org_id', orgId);

  const { data: sessionRows } = await supabase
    .from('sessions')
    .select(`
      id, session_date, session_name, description,
      attendance ( student_id, hours )
    `)
    .eq('org_id', orgId)
    .eq('school_year', sy)
    .order('session_date');

  // Build per-student totals
  const studentMap = {};
  (members ?? []).forEach(m => {
    const s = m.students;
    studentMap[s.id] = {
      memberId: m.id,
      studentId: s.id,
      lastName: s.last_name,
      firstName: s.first_name,
      grade: s.class,
      house: s.house,
      role: m.role ?? '',
      totalHrs: 0,
      sessions: [],
    };
  });

  const dateCols = [];
  (sessionRows ?? []).forEach(sess => {
    dateCols.push({
      id: sess.id,
      label: fmtDate(sess.session_date),
      sessionName: sess.session_name,
      description: sess.description ?? '',
    });
    (sess.attendance ?? []).forEach(a => {
      if (studentMap[a.student_id]) {
        studentMap[a.student_id].totalHrs += a.hours ?? 0;
        studentMap[a.student_id].sessions.push({
          sessionId: sess.id,
          date: fmtDate(sess.session_date),
          sessionName: sess.session_name,
          description: sess.description ?? '',
          hrs: a.hours ?? 0,
        });
      }
    });
  });

  const totalSessions = dateCols.length;
  const students = Object.values(studentMap).map(s => ({
    ...s,
    totalPct: totalSessions > 0
      ? ((s.sessions.length / totalSessions) * 100).toFixed(1) + '%'
      : '0.0%',
  }));

  return {
    orgId,
    orgName: org?.name ?? '',
    students,
    dateCols,
    activeSY: sy,
    lastSync: new Date().toLocaleString(),
  };
}

// ── MEMBERS ───────────────────────────────────────────────────
export async function addStudentToOrg(orgId, studentId, role = '') {
  const { error } = await supabase.from('org_members').insert({ org_id: orgId, student_id: studentId, role });
  if (error) {
    if (error.code === '23505') return { success: false, error: 'Already in this organization' };
    throw new Error(error.message);
  }
  return { success: true };
}

export async function removeStudentFromOrg(memberId) {
  const { error } = await supabase.from('org_members').delete().eq('id', memberId);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateMemberRole(memberId, role) {
  const { error } = await supabase.from('org_members').update({ role }).eq('id', memberId);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── SESSIONS ──────────────────────────────────────────────────
export async function addSession(orgId, sessionDate, sessionName, description, studentHours) {
  const sy = await getActiveSY();

  // Upsert session (allow multiple sessions per date)
  const { data: sess, error: sErr } = await supabase
    .from('sessions')
    .insert({ org_id: orgId, session_date: sessionDate, session_name: sessionName, description: description ?? '', school_year: sy })
    .select()
    .single();
  if (sErr) throw new Error(sErr.message);

  // Insert attendance rows
  const attRows = studentHours
    .filter(e => e.hrs > 0)
    .map(e => ({ session_id: sess.id, student_id: e.studentId, hours: e.hrs }));

  if (attRows.length) {
    const { error: aErr } = await supabase.from('attendance').upsert(attRows, { onConflict: 'session_id,student_id' });
    if (aErr) throw new Error(aErr.message);
  }
  return { success: true, sessionId: sess.id };
}

export async function deleteSessionHours(sessionId, studentId) {
  const { error } = await supabase
    .from('attendance')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', studentId);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteSession(sessionId) {
  // Cascades to attendance
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── MISC HOURS ────────────────────────────────────────────────
export async function addMiscHours(entry) {
  const sy = await getActiveSY();
  const { error } = await supabase.from('misc_hours').insert({
    teacher_email: entry.teacherEmail,
    teacher_name: entry.teacherName ?? '',
    student_id: entry.studentId ?? null,
    student_last: entry.studentLast.toUpperCase(),
    student_first: entry.studentFirst,
    task_name: entry.taskName,
    description: entry.description ?? '',
    event_date: entry.date,
    hours: parseFloat(entry.hours),
    school_year: sy,
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getMiscHours(teacherEmail = null) {
  const sy = await getActiveSY();
  let q = supabase.from('misc_hours').select('*').eq('school_year', sy).order('created_at', { ascending: false });
  if (teacherEmail) q = q.eq('teacher_email', teacherEmail.toLowerCase());
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    teacherEmail: r.teacher_email,
    teacherName: r.teacher_name,
    studentId: r.student_id,
    studentLast: r.student_last,
    studentFirst: r.student_first,
    taskName: r.task_name,
    description: r.description,
    date: fmtDate(r.event_date),
    hours: r.hours,
  }));
}

export async function deleteMiscHours(id) {
  const { error } = await supabase.from('misc_hours').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── STUDENT PROFILE ───────────────────────────────────────────
export async function getStudentData(email) {
  const sy = await getActiveSY();

  const { data: student } = await supabase
    .from('students')
    .select(`*, sy_hours ( school_year, hours )`)
    .eq('email', email.toLowerCase())
    .single();

  if (!student) return null;

  // All orgs this student is in this SY
  const { data: memberships } = await supabase
    .from('org_members')
    .select(`
      role,
      organizations!inner ( id, name, school_year ),
      students ( id )
    `)
    .eq('student_id', student.id)
    .eq('organizations.school_year', sy);

  // Attendance for this student this SY
  const { data: attRows } = await supabase
    .from('attendance')
    .select(`
      hours,
      sessions!inner ( id, session_date, session_name, description, school_year, org_id )
    `)
    .eq('student_id', student.id)
    .eq('sessions.school_year', sy);

  // Misc hours
  const { data: miscRows } = await supabase
    .from('misc_hours')
    .select('*')
    .eq('student_last', student.last_name)
    .eq('student_first', student.first_name)
    .eq('school_year', sy);

  // Build org breakdown
  const orgMap = {};
  (memberships ?? []).forEach(m => {
    const org = m.organizations;
    orgMap[org.id] = { orgId: org.id, orgName: org.name, role: m.role ?? '', totalHrs: 0, sessions: [] };
  });

  let currentHrs = 0;
  (attRows ?? []).forEach(a => {
    const sess = a.sessions;
    currentHrs += a.hours ?? 0;
    if (orgMap[sess.org_id]) {
      orgMap[sess.org_id].totalHrs += a.hours ?? 0;
      orgMap[sess.org_id].sessions.push({
        date: fmtDate(sess.session_date),
        sessionName: sess.session_name,
        description: sess.description ?? '',
        hrs: a.hours ?? 0,
      });
    }
  });

  // Misc total
  let miscTotal = 0;
  const miscSessions = (miscRows ?? []).map(r => {
    miscTotal += r.hours ?? 0;
    return { date: fmtDate(r.event_date), sessionName: r.task_name, description: r.description ?? '', hrs: r.hours ?? 0, teacherName: r.teacher_name ?? '', isMisc: true, id: r.id };
  });
  currentHrs += miscTotal;

  const orgs = Object.values(orgMap);
  if (miscTotal > 0) {
    orgs.push({ orgName: 'Misc Hours', role: '', totalHrs: miscTotal, totalPct: 'N/A', sessions: miscSessions });
  }

  // Attendance % per org
  orgs.forEach(o => {
    // Will be filled properly when we know session count — approximated here
    if (!o.totalPct) o.totalPct = '—';
  });

  return {
    email: student.email,
    id: student.id,
    lastName: student.last_name,
    firstName: student.first_name,
    class_: student.class,
    house: student.house,
    currentHrs,
    cumulHrs: student.cumulative_hrs ?? 0,
    activeSY: sy,
    syHrs: Object.fromEntries((student.sy_hours ?? []).map(r => [r.school_year, r.hours])),
    orgs,
    lastSync: new Date().toLocaleString(),
    appVersion: 'v7.0',
  };
}

// ── ADMIN SUMMARY ─────────────────────────────────────────────
export async function getAdminSummary() {
  const sy = await getActiveSY();

  const [{ data: students }, { data: orgs }, { data: sessions }, { data: misc }] = await Promise.all([
    supabase.from('students').select('*, sy_hours(school_year,hours)').eq('status', 'Active'),
    supabase.from('organizations').select('id, name').eq('school_year', sy).eq('active', true),
    supabase.from('sessions').select('id, org_id, session_date').eq('school_year', sy),
    supabase.from('misc_hours').select('student_id, student_last, student_first, hours').eq('school_year', sy),
  ]);

  const currentHrsMap = await getCurrentSYHoursMap(sy);

  const studentList = (students ?? []).map(s => ({
    id: s.id,
    lastName: s.last_name,
    firstName: s.first_name,
    class_: s.class,
    house: s.house,
    email: s.email,
    cumulHrs: s.cumulative_hrs ?? 0,
    currentHrs: currentHrsMap[s.id] ?? 0,
    syHrs: Object.fromEntries((s.sy_hours ?? []).map(r => [r.school_year, r.hours])),
  }));

  const total = studentList.length;
  const avgHrs = total > 0 ? Math.round(studentList.reduce((a, s) => a + s.currentHrs, 0) / total * 10) / 10 : 0;

  // Grade breakdown
  const gradeHrs = {};
  studentList.forEach(s => {
    const g = s.class_ || 'Unknown';
    if (!gradeHrs[g]) gradeHrs[g] = { count: 0, totalHrs: 0 };
    gradeHrs[g].count++;
    gradeHrs[g].totalHrs += s.currentHrs;
  });

  // Org stats
  const orgStats = {};
  (orgs ?? []).forEach(o => { orgStats[o.name] = { id: o.id, count: 0, totalHrs: 0, sessions: 0 }; });
  (sessions ?? []).forEach(sess => {
    const org = (orgs ?? []).find(o => o.id === sess.org_id);
    if (org && orgStats[org.name]) orgStats[org.name].sessions++;
  });

  // Monthly activity
  const monthly = {};
  (sessions ?? []).forEach(sess => {
    const d = new Date(sess.session_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly[key] = (monthly[key] ?? 0) + 1;
  });

  const topStudents = studentList
    .slice()
    .sort((a, b) => b.currentHrs - a.currentHrs)
    .slice(0, 10)
    .map(s => ({ name: `${s.firstName} ${s.lastName}`, hrs: s.currentHrs, class_: s.class_, email: s.email }));

  return {
    students: studentList,
    stats: { total, avgHrs, totalSessions: (sessions ?? []).length },
    orgStats,
    gradeHrs,
    monthly,
    topStudents,
    orgs: (orgs ?? []).map(o => ({ id: o.id, name: o.name })),
    activeSY: sy,
    lastSync: new Date().toLocaleString(),
    appVersion: 'v7.0',
  };
}

// ── SCHOOL YEAR ROLLOVER ──────────────────────────────────────
export async function startNewSchoolYear(newSY, selectedOrgIds = []) {
  const oldSY = await getActiveSY();

  // Save current SY totals to sy_hours
  const hrsMap = await getCurrentSYHoursMap(oldSY);
  const { data: students } = await supabase.from('students').select('id, cumulative_hrs');
  for (const s of (students ?? [])) {
    const hrs = hrsMap[s.id] ?? 0;
    if (hrs > 0) {
      await supabase.from('sy_hours').upsert(
        { student_id: s.id, school_year: oldSY, hours: hrs },
        { onConflict: 'student_id,school_year' }
      );
      await supabase.from('students').update({ cumulative_hrs: (s.cumulative_hrs ?? 0) + hrs }).eq('id', s.id);
    }
  }

  // Carry over selected orgs to new SY
  for (const orgId of selectedOrgIds) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).single();
    if (!org) continue;
    const { data: newOrg } = await supabase
      .from('organizations')
      .insert({ name: org.name, school_year: newSY, active: true })
      .select()
      .single();

    // Carry over members (excluding G12 — they graduated)
    const { data: members } = await supabase
      .from('org_members')
      .select('student_id, role, students(class)')
      .eq('org_id', orgId);

    const carryMembers = (members ?? []).filter(m => !(m.students?.class ?? '').includes('G12'));
    for (const m of carryMembers) {
      await supabase.from('org_members').insert({ org_id: newOrg.id, student_id: m.student_id, role: m.role }).catch(() => {});
    }
  }

  await setConfig('active_sy', newSY);
  sessionStorage.setItem('active_sy', newSY);
  return { success: true, oldSY, newSY };
}

// ── FLAGS ─────────────────────────────────────────────────────
export async function submitFlag(raisedByEmail, orgName, sessionDate, comment) {
  const { error } = await supabase.from('flags').insert({ raised_by_email: raisedByEmail, org_name: orgName, session_date: sessionDate, comment, status: 'Pending' });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getFlags() {
  const { data, error } = await supabase.from('flags').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(f => ({
    id: f.id,
    email: f.raised_by_email,
    orgName: f.org_name,
    sessionDate: f.session_date,
    comment: f.comment,
    status: f.status,
    resolution: f.resolution,
    timestamp: new Date(f.created_at).toLocaleString(),
  }));
}

export async function resolveFlag(id, status, resolution = '') {
  const { error } = await supabase.from('flags').update({ status, resolution }).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteFlag(id) {
  const { error } = await supabase.from('flags').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── OFF-CAMPUS ────────────────────────────────────────────────
export async function submitOffCampus(studentEmail, data) {
  const sy = await getActiveSY();
  const { error } = await supabase.from('off_campus').insert({
    student_email: studentEmail,
    org_name: data.orgName,
    event_date: data.eventDate,
    hours: parseFloat(data.hours),
    description: data.description,
    supervisor_name: data.supervisorName,
    supervisor_email: data.supervisorEmail,
    status: 'Pending',
    school_year: sy,
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getOffCampusPending() {
  const sy = await getActiveSY();
  const { data, error } = await supabase
    .from('off_campus')
    .select('*')
    .eq('status', 'Pending')
    .eq('school_year', sy)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    studentEmail: r.student_email,
    orgName: r.org_name,
    eventDate: fmtDate(r.event_date),
    hours: r.hours,
    description: r.description,
    supervisorName: r.supervisor_name,
    supervisorEmail: r.supervisor_email,
    timestamp: new Date(r.created_at).toLocaleString(),
  }));
}

export async function updateOffCampusStatus(id, status) {
  const { error } = await supabase.from('off_campus').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ── SETTINGS ──────────────────────────────────────────────────
export async function getSettings() {
  const [superAdmins, orgEditors, orgs, sy] = await Promise.all([
    getConfig('super_admins', []),
    getConfig('org_editors', {}),
    getOrgList(),
    getActiveSY(),
  ]);
  return { superAdmins, orgEditors, orgs: orgs.map(o => o.name), activeSY: sy };
}

export async function saveSuperAdmins(list) {
  await setConfig('super_admins', list.map(e => e.toLowerCase().trim()));
  return { success: true };
}

export async function saveOrgEditors(obj) {
  await setConfig('org_editors', obj);
  return { success: true };
}

// ── DATE FORMAT ───────────────────────────────────────────────
export function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d)) return String(raw);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}