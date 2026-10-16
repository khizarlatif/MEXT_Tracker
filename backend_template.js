var TRACKER_SHEET_URL         = "https://docs.google.com/spreadsheets/d/YOUR_GOOGLE_SHEET_ID_HERE/edit";
var TRACKER_SHEET_NAME        = "Sheet1";
var TRACKER_USER_EMAIL        = "your_email@gmail.com";
var IGNORED_DAYS_THRESHOLD         = 14;
var ACTION_REQUIRED_DAYS_THRESHOLD = 7;
var MAX_EXECUTION_TIME_MS          = 300000;
var BACKGROUND_SYNC_HOURS          = 8;
var RECENT_SYNC_QUERY              = "newer_than:2d";
var PORTFOLIO_ACCESS_KEY           = "";

function cleanTriggers(handlerName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function extractEmailAddress(raw) {
  if (!raw) return "";
  var match = raw.match(/<([^>]+)>/);
  if (match && match[1]) return match[1].toLowerCase().trim();
  return raw.replace(/["']/g, "").toLowerCase().trim();
}

function trackerFormatTS(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "MMM d, yyyy, hh:mm:ss a");
}

function trackerGetCol(headers, names) {
  var clean = headers.map(function(h) { return (h || '').toString().toLowerCase().replace(/[^a-z0-9]/g, ''); });
  for (var i = 0; i < names.length; i++) {
    var idx = clean.indexOf(names[i].toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (idx !== -1) return idx;
  }
  return -1;
}

function getTrackerCols(headers) {
  return {
    name:        trackerGetCol(headers, ["ProfessorName", "Professor Name", "Professor"]),
    uni:         trackerGetCol(headers, ["University", "Institution"]),
    research:    trackerGetCol(headers, ["Research Interest", "ResearchInterest"]),
    email:       trackerGetCol(headers, ["Email", "Email Address"]),
    linkedEmail: trackerGetCol(headers, ["Linked_Email", "Linked Email", "LinkedEmail"]),
    emailLogs:   trackerGetCol(headers, ["Email_Logs", "Email Logs", "EmailLogs"]),
    lastContact: trackerGetCol(headers, ["Last_Contact", "Last Contact", "LastContact"]),
    threadState: trackerGetCol(headers, ["Thread_State", "Thread State", "ThreadState"]),
    notes:       trackerGetCol(headers, ["Notes", "Note"]),
    replyStatus: trackerGetCol(headers, ["Reply_Status", "Reply Status", "ReplyStatus", "Reply_State", "Reply State"])
  };
}

function getTrackerSheet() {
  var ss = SpreadsheetApp.openByUrl(TRACKER_SHEET_URL);
  var sheet = ss.getSheetByName(TRACKER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  ensureTrackerHeaders(sheet);
  return sheet;
}

function ensureTrackerHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = getTrackerCols(headers);
  var nextCol = lastCol + 1;

  if (cols.notes === -1) {
    sheet.getRange(1, nextCol).setValue("Notes");
    nextCol++;
  }
  if (cols.replyStatus === -1) {
    sheet.getRange(1, nextCol).setValue("Reply_Status");
  }
}

function isBounceOrSystem(sender, subject) {
  var s   = (sender || "").toLowerCase();
  var sub = (subject || "").toLowerCase();
  return s.indexOf("mailer-daemon") !== -1 || s.indexOf("postmaster") !== -1 ||
         s.indexOf("noreply") !== -1       || s.indexOf("no-reply") !== -1   ||
         s.indexOf("bounce") !== -1        ||
         sub.indexOf("undeliverable") !== -1 || sub.indexOf("delivery status") !== -1 ||
         sub.indexOf("mail delivery failed") !== -1 ||
         sub.indexOf("out of office") !== -1 || sub.indexOf("automatic reply") !== -1 ||
         sub.indexOf("auto-reply") !== -1 || sub.indexOf("è‡ªåŠ¨å›žå¤") !== -1 ||
         sub.indexOf("ä¸åœ¨") !== -1 || sub.indexOf("è‡ªå‹•è¿”ä¿¡") !== -1;
}

function fetchEmailLogs(validEmails, maxThreads) {
  if (!validEmails || !validEmails.length) return null;
  var q = "to:(" + validEmails.join(" OR ") + ") OR from:(" + validEmails.join(" OR ") + ")";
  var threads = GmailApp.search(q, 0, maxThreads || 20);
  if (!threads || !threads.length) return null;

  var msgs = [];
  threads.forEach(function(th) {
    th.getMessages().forEach(function(m) { msgs.push(m); });
  });
  msgs.sort(function(a, b) { return a.getDate() - b.getDate(); });

  var lastDate = null;
  var lastSender = "";
  var hasProfReplied = false;
  var uEmail = TRACKER_USER_EMAIL.toLowerCase();
  var log = "";

  msgs.forEach(function(m) {
    lastDate = m.getDate();
    var sender = m.getFrom().toLowerCase();
    var subject = m.getSubject() || "";

    if (sender.indexOf(uEmail) === -1 && !isBounceOrSystem(sender, subject)) {
      hasProfReplied = true;
    }

    lastSender = sender;

    log += "  " + trackerFormatTS(m.getDate()) + "\n";
    log += "FROM: " + m.getFrom() + "\n";
    log += "TO: "   + m.getTo()   + "\n";
    log += "SUBJECT: " + m.getSubject() + "\n";
    var att = m.getAttachments();
    if (att && att.length) {
      log += "ATTACHMENTS: " + att.map(function(a) { return a.getName(); }).join(", ") + "\n";
    }
    log += "----------------------------------------\n";
    log += cleanBody(m.getPlainBody()) + "\n\n========================================\n\n";
  });

  return {
    logText: dedupeLog(log).trim(),
    lastContactDate: lastDate,
    lastSender: lastSender,
    hasProfReplied: hasProfReplied
  };
}

function calculateStatus(fetched, existingLastContactStr, currentThreadState, currentReplyStatus) {
  if (!fetched || !fetched.logText || !fetched.lastContactDate) {
    return {
      threadState: currentThreadState || "Not Contacted",
      replyStatus: currentReplyStatus || "No Reply"
    };
  }

  var uEmail = TRACKER_USER_EMAIL.toLowerCase();
  var lastSender = (fetched.lastSender || "").toLowerCase();
  var isLastSenderUser = lastSender.indexOf(uEmail) !== -1;
  var profReplied = fetched.hasProfReplied;

  var lastDate = fetched.lastContactDate;
  var now = Date.now();
  var daysSinceContact = (now - lastDate.getTime()) / 86400000;

  var isNewActivity = false;
  if (existingLastContactStr) {
    var prevDate = new Date(existingLastContactStr);
    if (!isNaN(prevDate.getTime())) {
      if (lastDate.getTime() - prevDate.getTime() > 60000) {
        isNewActivity = true;
      }
    } else {
      isNewActivity = true;
    }
  } else {
    isNewActivity = true;
  }

  var newThreadState = currentThreadState || "Not Contacted";
  var newReplyStatus = currentReplyStatus || "No Reply";

  if (profReplied) {
    newThreadState = "Replied";

    if (!isLastSenderUser) {
      if (isNewActivity) {
        newReplyStatus = "Action Required";
      } else {
        newReplyStatus = currentReplyStatus || "Action Required";
      }
    } else {
      var preservedManual = ["Accepted", "Rejected", "Ghosted"];
      if (preservedManual.indexOf(currentReplyStatus) !== -1 && !isNewActivity) {
        newReplyStatus = currentReplyStatus;
      } else if (daysSinceContact >= ACTION_REQUIRED_DAYS_THRESHOLD) {
        newReplyStatus = "Action Required";
      } else {
        newReplyStatus = "Awaiting Follow-up";
      }
    }
  } else {
    var preservedManual = ["Accepted", "Rejected", "Ghosted"];
    if (preservedManual.indexOf(currentReplyStatus) !== -1 && !isNewActivity) {
      newReplyStatus = currentReplyStatus;
    } else {
      newReplyStatus = "No Reply";
    }
    if (daysSinceContact >= IGNORED_DAYS_THRESHOLD) {
      newThreadState = "Ignored";
    } else {
      newThreadState = "Awaiting Reply";
    }
  }

  return {
    threadState: newThreadState,
    replyStatus: newReplyStatus
  };
}

function syncTrackerRow(sheet, row, rowIdx, cols, inMemoryOnly) {
  var emailCol  = (cols.email !== -1 ? row[cols.email] : "").toString().toLowerCase().trim();
  var linkedCol = (cols.linkedEmail !== -1 ? row[cols.linkedEmail] : "").toString().toLowerCase().trim();
  if (!emailCol && !linkedCol) return false;

  var rawList = emailCol.split(/[,;\s]+/).concat(linkedCol.split(/[,;\s]+/));
  var emails = [];
  rawList.forEach(function(e) {
    var clean = e.trim();
    if (clean && emails.indexOf(clean) === -1) emails.push(clean);
  });
  if (!emails.length) return false;

  var fetched = fetchEmailLogs(emails, 20);
  if (!fetched || !fetched.logText) return false;

  var lastDateStr = (fetched.lastContactDate) ? fetched.lastContactDate.toISOString() : "";
  var currLastContact = (cols.lastContact !== -1 ? (row[cols.lastContact] || "") : "").toString().trim();
  var currTState  = (cols.threadState !== -1 ? (row[cols.threadState] || "") : "").toString().trim();
  var currRStatus = (cols.replyStatus !== -1 ? (row[cols.replyStatus] || "") : "").toString().trim();

  var statusCalc = calculateStatus(fetched, currLastContact, currTState, currRStatus);

  if (inMemoryOnly) {
    if (cols.emailLogs !== -1)   row[cols.emailLogs]   = fetched.logText;
    if (cols.lastContact !== -1) row[cols.lastContact] = lastDateStr;
    if (cols.threadState !== -1) row[cols.threadState] = statusCalc.threadState;
    if (cols.replyStatus !== -1) row[cols.replyStatus] = statusCalc.replyStatus;
  } else {
    if (cols.emailLogs !== -1)   sheet.getRange(rowIdx, cols.emailLogs + 1).setValue(fetched.logText);
    if (cols.lastContact !== -1) sheet.getRange(rowIdx, cols.lastContact + 1).setValue(lastDateStr);
    if (cols.threadState !== -1) sheet.getRange(rowIdx, cols.threadState + 1).setValue(statusCalc.threadState);
    if (cols.replyStatus !== -1) sheet.getRange(rowIdx, cols.replyStatus + 1).setValue(statusCalc.replyStatus);
  }
  return true;
}

function setupBackgroundSync() {
  cleanTriggers('backgroundSync');
  cleanTriggers('backgroundSyncContinuation');
  ScriptApp.newTrigger('backgroundSync').timeBased().everyHours(BACKGROUND_SYNC_HOURS).create();
}

function backgroundSync() {
  syncEmailLogsToSheet(null, false);
}

function backgroundSyncContinuation() {
  cleanTriggers('backgroundSyncContinuation');
  syncEmailLogsToSheet(null, true);
}

function syncEmailLogsToSheet(syncId, isContinuation) {
  var startTime = Date.now();
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();

  function prog(stage, message, current, total) {
    if (!syncId) return;
    try {
      cache.put('sync_progress_' + syncId, JSON.stringify({
        stage: stage,
        message: message,
        current: current,
        total: total,
        timestamp: Date.now()
      }), 300);
    } catch(e) {}
  }

  var startRow = 1;
  var updated = 0;
  if (isContinuation) {
    startRow = parseInt(props.getProperty('RECENT_SYNC_ROW') || '1', 10);
    updated = parseInt(props.getProperty('RECENT_SYNC_COUNT') || '0', 10);
  } else {
    props.deleteProperty('RECENT_SYNC_ROW');
    props.deleteProperty('RECENT_SYNC_COUNT');
  }

  prog('fetching', 'Scanning Gmail (last 48h)...', 0, 100);

  var recentEmails = [];
  GmailApp.search(RECENT_SYNC_QUERY, 0, 150).forEach(function(th) {
    th.getMessages().forEach(function(m) {
      var fm = extractEmailAddress(m.getFrom());
      var tm = extractEmailAddress(m.getTo());
      if (fm && !isBounceOrSystem(fm, '')) recentEmails.push(fm);
      if (tm && !isBounceOrSystem(tm, '')) recentEmails.push(tm);
    });
  });

  var myEmail = TRACKER_USER_EMAIL.toLowerCase();
  var recentUnique = [];
  recentEmails.forEach(function(e) {
    if (e && e.indexOf(myEmail) === -1 && recentUnique.indexOf(e) === -1) {
      recentUnique.push(e);
    }
  });

  prog('fetching', 'Reading Tracker sheet...', 10, 100);
  var sheet = getTrackerSheet();
  var data  = sheet.getDataRange().getValues();
  if (!data.length) return;
  var cols  = getTrackerCols(data[0]);

  if (cols.email === -1 || cols.emailLogs === -1) {
    return;
  }

  var total = data.length - 1;
  var timedOut = false;
  var i = startRow;

  for (; i < data.length; i++) {
    if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
      prog('syncing', 'Approaching 5-minute limit. Saving batch at row ' + i + ' and auto-resuming in 30s...', i, total);
      timedOut = true;
      break;
    }

    var row = data[i];
    var profName = (cols.name !== -1 && row[cols.name]) ? row[cols.name].toString() : ('Row ' + i);
    var pEmail   = (cols.email !== -1 && row[cols.email]) ? row[cols.email].toString().toLowerCase() : '';
    var pLinked  = (cols.linkedEmail !== -1 && row[cols.linkedEmail]) ? row[cols.linkedEmail].toString().toLowerCase() : '';

    var rowEmails = pEmail.split(/[,;\s]+/).concat(pLinked.split(/[,;\s]+/)).map(function(s) { return s.trim(); }).filter(Boolean);
    var needsSync = false;

    for (var k = 0; k < rowEmails.length; k++) {
      if (recentUnique.indexOf(rowEmails[k]) !== -1) {
        needsSync = true;
        break;
      }
    }

    if (!needsSync) {
      if (cols.threadState !== -1 && cols.lastContact !== -1) {
        var cs = (row[cols.threadState] || "").toString().trim();
        if (cs === "Awaiting Reply") {
          var lcStr = (row[cols.lastContact] || "").toString().trim();
          if (lcStr) {
            var lcDate = new Date(lcStr);
            if (!isNaN(lcDate.getTime()) && (Date.now() - lcDate.getTime()) / 86400000 >= IGNORED_DAYS_THRESHOLD) {
              row[cols.threadState] = "Ignored";
              row[cols.replyStatus] = "No Reply";
              updated++;
            }
          }
        }
      }
      continue;
    }

    prog('syncing', 'Syncing ' + profName + '...', i, total);
    if (syncTrackerRow(sheet, row, i + 1, cols, true)) {
      updated++;
      prog('syncing', 'âœ“ ' + profName + ' updated', i, total);
    }
  }

  if (i > startRow) {
    var chunk = data.slice(startRow, i);
    if (chunk.length > 0) {
      sheet.getRange(startRow + 1, 1, chunk.length, chunk[0].length).setValues(chunk);
    }
  }

  props.setProperty('RECENT_SYNC_COUNT', updated.toString());

  if (timedOut && i < data.length) {
    props.setProperty('RECENT_SYNC_ROW', i.toString());
    cleanTriggers('backgroundSyncContinuation');
    ScriptApp.newTrigger('backgroundSyncContinuation').timeBased().after(30000).create();
    prog('done', 'Saved batch of ' + updated + ' professors. Auto-resuming remaining rows in 30s...', total, total);
  } else {
    props.deleteProperty('RECENT_SYNC_ROW');
    props.deleteProperty('RECENT_SYNC_COUNT');
    cleanTriggers('backgroundSyncContinuation');
    prog('done', 'Synced ' + updated + ' professors.', total, total);
  }
}

function syncFullHistoryAll(e) {
  var start = Date.now();
  var props = PropertiesService.getScriptProperties();

  if (!e || !e.triggerUid) {
    cleanTriggers('syncFullHistoryAll');
    props.setProperty('FULL_SYNC_ROW', '1');
    props.setProperty('FULL_SYNC_COUNT', '0');
  }

  var sheet = getTrackerSheet();
  var data  = sheet.getDataRange().getValues();
  if (!data.length) return;
  var cols     = getTrackerCols(data[0]);
  var nextRow  = parseInt(props.getProperty('FULL_SYNC_ROW') || '1', 10);
  var updated  = parseInt(props.getProperty('FULL_SYNC_COUNT') || '0', 10);
  var startRow = nextRow;
  var i        = nextRow;

  for (; i < data.length; i++) {
    if (Date.now() - start > MAX_EXECUTION_TIME_MS) {
      break;
    }

    var profName = (data[i][cols.name] || 'Row ' + i).toString();
    if (syncTrackerRow(sheet, data[i], i + 1, cols, true)) {
      updated++;
    }
  }

  if (i > startRow) {
    var chunk = data.slice(startRow, i);
    if (chunk.length > 0) {
      sheet.getRange(startRow + 1, 1, chunk.length, chunk[0].length).setValues(chunk);
    }
  }

  props.setProperty('FULL_SYNC_COUNT', updated.toString());

  if (i >= data.length) {
    props.deleteProperty('FULL_SYNC_ROW');
    props.deleteProperty('FULL_SYNC_COUNT');
    cleanTriggers('syncFullHistoryAll');
  } else {
    props.setProperty('FULL_SYNC_ROW', i.toString());
    cleanTriggers('syncFullHistoryAll');
    ScriptApp.newTrigger('syncFullHistoryAll').timeBased().after(30000).create();
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.syncId) {
    var cache = CacheService.getScriptCache();
    var data  = cache.get('sync_progress_' + e.parameter.syncId);
    return ContentService.createTextOutput(
      JSON.stringify(data ? { status: 'success', progress: JSON.parse(data) } : { status: 'waiting' })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("Tracker Backend Active!").setMimeType(ContentService.MimeType.TEXT);
}

function findRowIndex(data, cols, email, linkedEmail, name, uni, oldEmail, oldLinked, oldName, oldUni) {
  var targetEmail  = (email || '').toLowerCase().trim();
  var targetLinked = (linkedEmail || '').toLowerCase().trim();
  var targetName   = (name || '').toLowerCase().trim();
  var targetUni    = (uni || '').toLowerCase().trim();

  var oEmail  = (oldEmail || '').toLowerCase().trim();
  var oLinked = (oldLinked || '').toLowerCase().trim();
  var oName   = (oldName || '').toLowerCase().trim();
  var oUni    = (oldUni || '').toLowerCase().trim();

  for (var i = 1; i < data.length; i++) {
    var rEmail  = cols.email !== -1 ? (data[i][cols.email] || '').toString().toLowerCase().trim() : '';
    var rLinked = cols.linkedEmail !== -1 ? (data[i][cols.linkedEmail] || '').toString().toLowerCase().trim() : '';
    if (targetEmail && (rEmail === targetEmail || rLinked === targetEmail)) return i + 1;
    if (targetLinked && (rEmail === targetLinked || rLinked === targetLinked)) return i + 1;
  }

  if (targetName && targetUni) {
    for (var i = 1; i < data.length; i++) {
      var rName = cols.name !== -1 ? (data[i][cols.name] || '').toString().toLowerCase().trim() : '';
      var rUni  = cols.uni !== -1 ? (data[i][cols.uni] || '').toString().toLowerCase().trim() : '';
      if (rName === targetName && rUni === targetUni) return i + 1;
    }
  }

  if (oEmail || oLinked) {
    for (var i = 1; i < data.length; i++) {
      var rEmail  = cols.email !== -1 ? (data[i][cols.email] || '').toString().toLowerCase().trim() : '';
      var rLinked = cols.linkedEmail !== -1 ? (data[i][cols.linkedEmail] || '').toString().toLowerCase().trim() : '';
      if (oEmail && (rEmail === oEmail || rLinked === oEmail)) return i + 1;
      if (oLinked && (rEmail === oLinked || rLinked === oLinked)) return i + 1;
    }
  }

  if (oName && oUni) {
    for (var i = 1; i < data.length; i++) {
      var rName = cols.name !== -1 ? (data[i][cols.name] || '').toString().toLowerCase().trim() : '';
      var rUni  = cols.uni !== -1 ? (data[i][cols.uni] || '').toString().toLowerCase().trim() : '';
      if (rName === oName && rUni === oUni) return i + 1;
    }
  }

  return -1;
}

function doPost(e) {
  try {
    var raw = (e.parameter && e.parameter.payload) ? e.parameter.payload : (e.postData ? e.postData.contents : "{}");
    var payload = JSON.parse(raw);

    if (PORTFOLIO_ACCESS_KEY && PORTFOLIO_ACCESS_KEY.trim() !== "") {
      var clientKey = payload.accessKey || (e.parameter ? e.parameter.accessKey : "");
      if (clientKey !== PORTFOLIO_ACCESS_KEY) {
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'error', message: 'Unauthorized: Invalid portfolio access key' })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    var sheet = getTrackerSheet();
    var data  = sheet.getDataRange().getValues();
    var cols  = getTrackerCols(data[0]);

    if (payload.action === 'syncAndFetch') {
      if (payload.syncId) {
        syncEmailLogsToSheet(payload.syncId, false);
        data = sheet.getDataRange().getValues();
        cols = getTrackerCols(data[0]);
      }

      var rows = [];
      for (var i = 1; i < data.length; i++) {
        var r = data[i];
        rows.push({
          "ProfessorName":     cols.name        !== -1 ? (r[cols.name]        || '') : '',
          "University":        cols.uni         !== -1 ? (r[cols.uni]         || '') : '',
          "Research Interest": cols.research    !== -1 ? (r[cols.research]    || '') : '',
          "Email":             cols.email       !== -1 ? (r[cols.email]       || '') : '',
          "Linked_Email":      cols.linkedEmail !== -1 ? (r[cols.linkedEmail] || '') : '',
          "Email_Logs":        cols.emailLogs   !== -1 ? (r[cols.emailLogs]   || '') : '',
          "Last_Contact":      cols.lastContact !== -1 ? (r[cols.lastContact] || '') : '',
          "Thread_State":      cols.threadState !== -1 ? (r[cols.threadState] || '') : '',
          "Notes":             cols.notes       !== -1 ? (r[cols.notes]       || '') : '',
          "Reply_Status":      cols.replyStatus !== -1 ? (r[cols.replyStatus] || '') : ''
        });
      }

      return ContentService.createTextOutput(
        JSON.stringify({ status: 'success', data: rows })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'saveProfessor' || payload.action === 'updateRowData') {
      var prof = payload.professor || payload.updates || {};
      var targetEmail  = payload.email || prof.email || '';
      var targetLinked = payload.linkedEmail || prof.linkedEmail || '';
      var targetName   = payload.professorName || prof.professorName || '';
      var targetUni    = payload.university || prof.university || '';

      var oldEmail     = payload.oldEmail || '';
      var oldLinked    = payload.oldLinkedEmail || '';
      var oldName      = payload.oldProfessorName || '';
      var oldUni       = payload.oldUniversity || '';

      var rowIdx = findRowIndex(data, cols, targetEmail, targetLinked, targetName, targetUni, oldEmail, oldLinked, oldName, oldUni);

      if (rowIdx !== -1) {
        if (prof.professorName && cols.name !== -1) sheet.getRange(rowIdx, cols.name + 1).setValue(prof.professorName);
        if (prof.university && cols.uni !== -1) sheet.getRange(rowIdx, cols.uni + 1).setValue(prof.university);
        if (prof.researchInterest !== undefined && cols.research !== -1) sheet.getRange(rowIdx, cols.research + 1).setValue(prof.researchInterest);
        if (prof.email && cols.email !== -1) sheet.getRange(rowIdx, cols.email + 1).setValue(prof.email);
        if (prof.linkedEmail !== undefined && cols.linkedEmail !== -1) sheet.getRange(rowIdx, cols.linkedEmail + 1).setValue(prof.linkedEmail);
        if (prof.notes !== undefined && cols.notes !== -1) sheet.getRange(rowIdx, cols.notes + 1).setValue(prof.notes);
        if (prof.replyStatus && cols.replyStatus !== -1) sheet.getRange(rowIdx, cols.replyStatus + 1).setValue(prof.replyStatus);
        if (prof.threadState && cols.threadState !== -1) sheet.getRange(rowIdx, cols.threadState + 1).setValue(prof.threadState);

        return ContentService.createTextOutput(
          JSON.stringify({ status: 'success', message: 'Updated row ' + rowIdx })
        ).setMimeType(ContentService.MimeType.JSON);
      } else {
        var newRow = new Array(data[0].length).fill("");
        if (cols.name !== -1)        newRow[cols.name]        = prof.professorName || "";
        if (cols.uni !== -1)         newRow[cols.uni]         = prof.university || "";
        if (cols.research !== -1)    newRow[cols.research]    = prof.researchInterest || "";
        if (cols.email !== -1)       newRow[cols.email]       = prof.email || "";
        if (cols.linkedEmail !== -1) newRow[cols.linkedEmail] = prof.linkedEmail || "";
        if (cols.notes !== -1)       newRow[cols.notes]       = prof.notes || "";
        if (cols.replyStatus !== -1) newRow[cols.replyStatus] = prof.replyStatus || "No Reply";
        if (cols.threadState !== -1) newRow[cols.threadState] = prof.threadState || "Not Contacted";
        if (cols.lastContact !== -1) newRow[cols.lastContact] = "";
        if (cols.emailLogs !== -1)   newRow[cols.emailLogs]   = "";

        sheet.appendRow(newRow);
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'success', message: 'Inserted new row' })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (payload.action === 'deleteProfessor') {
      var delEmail  = payload.email || '';
      var delLinked = payload.linkedEmail || '';
      var delName   = payload.professorName || '';
      var delUni    = payload.university || '';

      var rowIdx = findRowIndex(data, cols, delEmail, delLinked, delName, delUni);
      if (rowIdx !== -1) {
        sheet.deleteRow(rowIdx);
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'success', message: 'Deleted row ' + rowIdx })
        ).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'Professor not found' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'triggerFullHistorySync') {
      cleanTriggers('syncFullHistoryAll');
      PropertiesService.getScriptProperties().setProperty('FULL_SYNC_ROW', '1');
      PropertiesService.getScriptProperties().setProperty('FULL_SYNC_COUNT', '0');
      ScriptApp.newTrigger('syncFullHistoryAll').timeBased().after(1000).create();
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'success', message: 'Full historical sync triggered in background with 5m auto-resume.' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'getFullHistorySyncStatus') {
      var props = PropertiesService.getScriptProperties();
      var curRow = props.getProperty('FULL_SYNC_ROW');
      var updatedCount = props.getProperty('FULL_SYNC_COUNT');
      return ContentService.createTextOutput(
        JSON.stringify({
          status: 'success',
          currentRow: curRow ? parseInt(curRow, 10) : null,
          updatedCount: updatedCount ? parseInt(updatedCount, 10) : 0
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: 'Unknown action: ' + payload.action })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

var QUOTE_PATTERNS = [
  /^_{10,}\s*$/,
  /^={10,}\s*$/,
  /^-{3,}\s*$/,
  /^[\s\-]*(?:Original(?: Message)?|Replied Message|Forwarded Message|åŽŸå§‹é‚®ä»¶|å…ƒã®ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸|è»¢é€ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸)[\s\-:ï¼š]*$/i,
  /^On\s+[\s\S]{1,300}?\s+wrote:\s*/i,
  /^At\s+[\s\S]{1,300}?\s+wrote:\s*/i,
  /^[^<\n]{0,120}<[^>]+>\s*wrote:\s*/i,
  /^wrote:\s*/i,
  /^(?:From|Sent|To|Cc|Bcc|Subject|Date|å‘ä»¶äºº|æ”¶ä»¶äºº|æŠ„é€|å¯†é€|ä¸»é¢˜|æ—¥æœŸ|æ—¶é—´|å·®å‡ºäºº|é€ä¿¡æ—¥æ™‚|å®›å…ˆ|ä»¶å|æ—¥ä»˜|æ—¥æ™‚)[:ï¼š]\s*/i,
  /^--\s*$/,
  /^.{0,120}?(?:åœ¨|äºŽ)\s*[\s\S]{1,150}?\s*å†™é“[ï¼š:]/i,
  /^.{0,120}?äºŽ\s*\d{4}å¹´\d{1,2}æœˆ\d{1,2}æ—¥[\s\S]{0,60}?å†™é“[ï¼š:]/i,
  /^(?:åœ¨\s*)?\d{4}å¹´\d{1,2}æœˆ\d{1,2}æ—¥[\s\S]{0,60}?å†™[åˆ°é“][ï¼š:]/i,
  /^.{0,120}?(?:ã•ã‚“|æ§˜|å…ˆç”Ÿ)?(?:ã¯|ã‚ˆã‚Š)[\s\S]{0,100}?(?:æ›¸ãã¾ã—ãŸ|é€ä¿¡ã—ã¾ã—ãŸ)[ï¼š:]/i,
  /^\d{4}å¹´\d{1,2}æœˆ\d{1,2}æ—¥[\s\S]{0,60}?(?:æ›¸ãã¾ã—ãŸ|é€ä¿¡ã—ã¾ã—ãŸ)[ï¼š:]/i,
  /^Sent from my (?:iPhone|iPad|Android|Galaxy|Samsung|Huawei|Mobile|Xiaomi)/i,
  /^(?:iPhone|iPad|Android) ã‹ã‚‰é€ä¿¡/i,
  /^(?:Get|Download) Outlook for (?:iOS|Android)/i,
  /^-{2,}\s*(?:Forwarded message|Original message|åŽŸå§‹é‚®ä»¶|å…ƒã®ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸|è»¢é€ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸)\s*-{2,}$/i,
  /^Begin forwarded message:\s*$/i,
  /^(?:CONFIDENTIALITY NOTICE|DISCLAIMER)[:\-]\s*$/i
];

function cleanBody(raw) {
  if (!raw || typeof raw !== 'string') return '';
  var body = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
                .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
                .replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');

  body = body.replace(/([^\n]+?)\s*([a-zA-Z0-9._%+-]+(?:@[a-zA-Z0-9.-]+)?\s*(?:åœ¨|äºŽ)\s*\d{4}å¹´[\s\S]{1,80}?å†™é“[ï¼š:])/g, '$1\n$2');
  body = body.replace(/([^\n]+?)\s*([a-zA-Z0-9._%+-]+(?:@[a-zA-Z0-9.-]+)?\s*\d{4}å¹´\d{1,2}æœˆ\d{1,2}æ—¥[\s\S]{1,80}?(?:æ›¸ãã¾ã—ãŸ|é€ä¿¡ã—ã¾ã—ãŸ)[ï¼š:])/g, '$1\n$2');
  body = body.replace(/([^\n]+?)\s*([^\n]{2,40}?(?:ã•ã‚“|æ§˜|å…ˆç”Ÿ)(?:ã¯|ã‚ˆã‚Š)[\s\S]{0,60}?(?:æ›¸ãã¾ã—ãŸ|é€ä¿¡ã—ã¾ã—ãŸ)[ï¼š:])/g, '$1\n$2');
  body = body.replace(/([^\n]+?)\s*(Original[:ï¼š]|\-{3,}\s*(?:Original Message|Forwarded Message|åŽŸå§‹é‚®ä»¶|å…ƒã®ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸|è»¢é€ãƒ¡ãƒƒã‚»ãƒ¼ã‚¸)\s*\-{3,})/gi, '$1\n$2');

  body = body.replace(/((?:^|\n)(?:On|At)\s[^\n]{0,200})\n+([^\n]{0,200}?wrote:\s*)/gi, function(m, p1, p2) { return p1 + ' ' + p2; });
  body = body.replace(/((?:^|\n)[^\n]{0,120}?(?:åœ¨|äºŽ)[^\n]{0,150})\n+([^\n]{0,150}?å†™é“[ï¼š:]\s*)/g, function(m, p1, p2) { return p1 + ' ' + p2; });
  body = body.replace(/((?:^|\n)[^\n]{0,120}?(?:ã•ã‚“|æ§˜|å…ˆç”Ÿ)?(?:ã¯|ã‚ˆã‚Š)[^\n]{0,100})\n+([^\n]{0,100}?(?:æ›¸ãã¾ã—ãŸ|é€ä¿¡ã—ã¾ã—ãŸ)[ï¼š:]\s*)/g, function(m, p1, p2) { return p1 + ' ' + p2; });

  var lines = body.split('\n');
  var out = [];
  var hasContent = false;

  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].replace(/[ \t]+$/, '');
    var t = l.trim();
    var boundary = QUOTE_PATTERNS.some(function(p) { return p.test(t); });
    if (boundary) {
      if (hasContent) break;
      continue;
    }
    if (/^>+\s*/.test(t)) continue;
    out.push(l);
    if (t) hasContent = true;
  }

  var collapsed = [];
  var blank = false;
  out.forEach(function(l) {
    var b = !l.trim();
    if (b && blank) return;
    collapsed.push(l);
    blank = b;
  });

  var result = collapsed.join('\n').trim();
  if (!result && body.replace(/\s+/g, '').length > 15) return body.trim();
  return result;
}

function dedupeLog(logText) {
  if (!logText) return logText;
  var blocks = logText.split(/\n={40,}\n/).map(function(b) { return b.trim(); }).filter(Boolean);
  var seen = [];
  var kept = [];

  blocks.forEach(function(block) {
    var parts = block.split(/\n-{40,}\n/);
    var norm  = parts.slice(1).join('').replace(/\s+/g, ' ').trim();
    var dup   = false;
    if (norm.length > 30) {
      dup = seen.some(function(s) {
        return s === norm || s.indexOf(norm) !== -1 || (norm.indexOf(s) !== -1 && norm.length - s.length < 40);
      });
      if (!dup) seen.push(norm);
    }
    if (!dup) kept.push(block);
  });

  return kept.join('\n\n========================================\n\n');
}
