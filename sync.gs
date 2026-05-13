// ============================================================
// sync.gs — Google Apps Script: Sync "masterfile" tab → Supabase
//
// Setup:
//   1. Open your Google Sheet → Extensions → Apps Script
//   2. Paste this file's contents into the editor
//   3. Set Script Properties (Project Settings → Script Properties):
//        SUPABASE_URL  = https://xemsndgnkfsmheugcwlf.supabase.co
//        SUPABASE_KEY  = <your service_role key from Supabase Dashboard>
//   4. Run syncMasterfile() manually or add a time-based trigger
//
// Masterfile tab expected columns (row 1 = headers, case-insensitive):
//   ID | Last Name | First Name | Class | House
//   (column order does not matter — headers are detected automatically)
//
// Valid class values: G9RL G9RP G9 G10A G10P G10 G11A G11L G11 G12V G12P G12
// Valid house values: 1-Truthful 2-Organized 3-Reflective 4-Courageous 5-Helpful
// ============================================================

var VALID_CLASSES = ['G9RL','G9RP','G9','G10A','G10P','G10','G11A','G11L','G11','G12V','G12P','G12'];
var VALID_HOUSES  = ['1-Truthful','2-Organized','3-Reflective','4-Courageous','5-Helpful'];
var HEADER_MAP    = {
  'id': 'id', 'student id': 'id', 'sid': 'id',
  'last name': 'lastName', 'lastname': 'lastName', 'last': 'lastName', 'surname': 'lastName',
  'first name': 'firstName', 'firstname': 'firstName', 'first': 'firstName', 'given name': 'firstName',
  'class': 'class_', 'grade': 'class_', 'section': 'class_',
  'house': 'house', 'homeroom': 'house',
};

function syncMasterfile() {
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = props.getProperty('SUPABASE_URL');
  var SUPABASE_KEY = props.getProperty('SUPABASE_KEY');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    SpreadsheetApp.getUi().alert(
      'Missing Script Properties.\n\n' +
      'Go to Project Settings → Script Properties and add:\n' +
      '  SUPABASE_URL  = https://xemsndgnkfsmheugcwlf.supabase.co\n' +
      '  SUPABASE_KEY  = <your service_role key>'
    );
    return;
  }

  // ── 1. Read masterfile tab ──────────────────────────────────
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('masterfile') || ss.getSheetByName('Masterfile') || ss.getSheetByName('MASTERFILE');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('ERROR: No sheet named "masterfile" found.\nMake sure the tab is named exactly "masterfile".');
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('ERROR: masterfile tab appears empty (no data rows).');
    return;
  }

  // Detect column positions from header row
  var headers = data[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var colMap  = {};
  headers.forEach(function(h, i){
    var field = HEADER_MAP[h];
    if (field) colMap[field] = i;
  });

  var required = ['id', 'lastName', 'firstName', 'class_'];
  var missing  = required.filter(function(f){ return colMap[f] === undefined; });
  if (missing.length) {
    SpreadsheetApp.getUi().alert(
      'ERROR: Could not find required columns in masterfile header row.\n\n' +
      'Missing: ' + missing.join(', ') + '\n\n' +
      'Expected headers (case-insensitive):\n' +
      '  ID | Last Name | First Name | Class | House'
    );
    return;
  }

  // ── 2. Parse rows ───────────────────────────────────────────
  var masterStudents = [];
  var rowErrors      = [];
  var seenIds        = {};

  for (var r = 1; r < data.length; r++) {
    var row    = data[r];
    var rowNum = r + 1; // 1-based for display

    var rawId    = String(row[colMap['id']]    || '').trim();
    var rawLast  = String(row[colMap['lastName']]  || '').trim().toUpperCase();
    var rawFirst = String(row[colMap['firstName']] || '').trim();
    var rawClass = String(row[colMap['class_']]    || '').trim();
    var rawHouse = colMap['house'] !== undefined ? String(row[colMap['house']] || '').trim() : '';

    // Skip completely blank rows
    if (!rawId && !rawLast && !rawFirst) continue;

    var rowErrs = [];
    if (!rawId)    rowErrs.push('missing ID');
    if (!rawLast)  rowErrs.push('missing Last Name');
    if (!rawFirst) rowErrs.push('missing First Name');
    if (!rawClass) rowErrs.push('missing Class');

    if (rawId && seenIds[rawId]) {
      rowErrs.push('duplicate ID "' + rawId + '"');
    }

    if (rawClass && VALID_CLASSES.indexOf(rawClass) === -1) {
      rowErrs.push('invalid class "' + rawClass + '" (valid: ' + VALID_CLASSES.join(', ') + ')');
    }
    if (rawHouse && VALID_HOUSES.indexOf(rawHouse) === -1) {
      rowErrs.push('invalid house "' + rawHouse + '" (valid: ' + VALID_HOUSES.join(', ') + ')');
    }

    if (rowErrs.length) {
      rowErrors.push('Row ' + rowNum + ': ' + rowErrs.join('; '));
      continue;
    }

    seenIds[rawId] = true;
    masterStudents.push({
      id:         rawId,
      last_name:  rawLast,
      first_name: rawFirst,
      class_:     rawClass,
      house:      rawHouse || '',
      email:      rawId.replace(/-/g,'').replace(/\s/g,'') + '@dishs.tp.edu.tw',
      status:     'Active',
    });
  }

  if (rowErrors.length) {
    var proceed = SpreadsheetApp.getUi().alert(
      'WARNINGS — ' + rowErrors.length + ' row(s) had errors and will be SKIPPED:\n\n' +
      rowErrors.slice(0, 20).join('\n') +
      (rowErrors.length > 20 ? '\n…and ' + (rowErrors.length - 20) + ' more' : '') +
      '\n\nContinue syncing the remaining ' + masterStudents.length + ' valid rows?',
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (proceed !== SpreadsheetApp.getUi().Button.YES) return;
  }

  if (!masterStudents.length) {
    SpreadsheetApp.getUi().alert('No valid student rows to sync.');
    return;
  }

  // ── 3. Fetch current students from Supabase ─────────────────
  var existing = supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'GET',
    '/rest/v1/students?select=id,last_name,first_name,class,house,email,status&limit=10000', null);

  if (existing.error) {
    SpreadsheetApp.getUi().alert('ERROR fetching students from Supabase:\n' + existing.error);
    return;
  }

  var dbMap = {};
  (existing || []).forEach(function(s){ dbMap[s.id] = s; });

  var masterIds = {};
  masterStudents.forEach(function(s){ masterIds[s.id] = true; });

  // Students in DB but not in masterfile
  var dbOnlyIds = Object.keys(dbMap).filter(function(id){ return !masterIds[id]; });

  // ── 4. Upsert masterfile students ───────────────────────────
  var toUpsert = masterStudents.map(function(s){
    return {
      id:             s.id,
      last_name:      s.last_name,
      first_name:     s.first_name,
      class:          s.class_,
      house:          s.house,
      email:          s.email,
      status:         'Active',
    };
  });

  // Upsert in batches of 100
  var BATCH = 100;
  var upsertErrors = [];
  for (var i = 0; i < toUpsert.length; i += BATCH) {
    var batch = toUpsert.slice(i, i + BATCH);
    var result = supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'POST',
      '/rest/v1/students?on_conflict=id', batch);
    if (result && result.error) {
      upsertErrors.push('Batch ' + Math.floor(i/BATCH+1) + ': ' + result.error);
    }
  }

  // ── 5. Report ───────────────────────────────────────────────
  var report = [];
  report.push('✓ Synced ' + masterStudents.length + ' students from masterfile to Supabase.');

  if (upsertErrors.length) {
    report.push('\nERRORS during upsert:\n' + upsertErrors.join('\n'));
  }

  if (dbOnlyIds.length) {
    var names = dbOnlyIds.map(function(id){
      var s = dbMap[id];
      return '  ' + id + ' — ' + s.last_name + ', ' + s.first_name + ' (' + s.class + ')';
    });
    report.push(
      '\n⚠ ' + dbOnlyIds.length + ' student(s) are in the database but NOT in the masterfile.\n' +
      'They were NOT deleted — review manually:\n' +
      names.slice(0, 30).join('\n') +
      (names.length > 30 ? '\n  …and ' + (names.length - 30) + ' more' : '')
    );
  }

  if (rowErrors.length) {
    report.push('\n⚠ ' + rowErrors.length + ' row(s) skipped due to errors (see warning above).');
  }

  SpreadsheetApp.getUi().alert(report.join('\n'));
  Logger.log(report.join('\n'));
}

// ── Supabase REST helper ────────────────────────────────────────
function supabaseFetch(url, key, method, path, payload) {
  var options = {
    method:  method,
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'resolution=merge-duplicates' : '',
    },
    muteHttpExceptions: true,
  };
  if (payload) options.payload = JSON.stringify(payload);

  try {
    var resp = UrlFetchApp.fetch(url + path, options);
    var code = resp.getResponseCode();
    var body = resp.getContentText();
    if (code >= 400) {
      var msg = body;
      try { msg = JSON.parse(body).message || body; } catch(_){}
      return { error: 'HTTP ' + code + ': ' + msg };
    }
    if (!body || body === 'null') return [];
    return JSON.parse(body);
  } catch(e) {
    return { error: e.message };
  }
}

// ── Add menu item when spreadsheet opens ───────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Service Hours')
    .addItem('Sync Masterfile → Supabase', 'syncMasterfile')
    .addToUi();
}
