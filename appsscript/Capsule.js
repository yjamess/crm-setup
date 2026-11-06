// Capsule API calls (replaces Notion.gs). https://developer.capsulecrm.com/v2/
// Keeps the same function names Provision.gs calls: queryAllCandidates, fetchPage,
// updatePage and the build*Update helpers.

var CAPSULE_API = 'https://api.capsulecrm.com/api/v2';

function truncateMessage(message) {
  var text = String(message || 'Unknown error');
  return text.length <= 500 ? text : text.slice(0, 497) + '...';
}

function folderUrl(folderId) {
  return 'https://drive.google.com/drive/folders/' + folderId;
}

function todayInScriptZone() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * @returns {{status: number, body: Object, headers: Object}}
 */
function capsuleRequest(runtime, method, path, body) {
  var options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + runtime.capsuleToken, Accept: 'application/json' },
  };
  if (body) options.payload = JSON.stringify(body);
  for (var attempt = 0; attempt < 3; attempt++) {
    var response = UrlFetchApp.fetch(CAPSULE_API + path, options);
    var status = response.getResponseCode();
    if (status === 429) { Utilities.sleep(20000); continue; }
    var text = response.getContentText() || '';
    var parsed = {};
    if (text) { try { parsed = JSON.parse(text); } catch (err) { parsed = { message: text }; } }
    if (status < 200 || status >= 300) {
      throw new Error('Capsule returned ' + status + ': ' + truncateMessage(parsed.message || text));
    }
    return { status: status, body: parsed, headers: response.getAllHeaders() };
  }
  throw new Error('Capsule rate limit reached.');
}

/** Field definition IDs by name, read once per run. */
function fieldDefinitions(runtime) {
  if (runtime._defs) return runtime._defs;
  var defs = {};
  capsuleRequest(runtime, 'get', '/parties/fields/definitions?perPage=100').body.definitions.forEach(
    function (d) { defs[d.name] = d.id; }
  );
  [runtime.properties.driveProvisioning, runtime.properties.driveFolderId, runtime.properties.driveFolderUrl]
    .forEach(function (name) {
      if (!defs[name]) throw new Error('Capsule has no custom field called "' + name + '".');
    });
  runtime._defs = defs;
  return defs;
}

function fieldValue(party, name) {
  var match = (party.fields || []).filter(function (f) { return f.definition && f.definition.name === name; });
  return match.length && match[0].value !== null && match[0].value !== undefined ? String(match[0].value).trim() : '';
}

/**
 * Turns a Capsule organisation into the small object the rest of the script uses.
 * Tagged organisations with no folder and no explicit status count as Ready.
 */
function normalizeCapsuleParty(party, runtime) {
  var status = fieldValue(party, runtime.properties.driveProvisioning);
  var folderId = fieldValue(party, runtime.properties.driveFolderId);
  var tags = (party.tags || []).map(function (t) { return t.name; });
  var tagged = runtime.triggerTags.some(function (t) { return tags.indexOf(t) !== -1; });
  if (!status && !folderId && tagged) status = runtime.status.ready;
  var required = {};
  (runtime.requiredProperties || []).forEach(function (name) { required[name] = fieldValue(party, name); });
  return { id: String(party.id), name: String(party.name || '').trim(), status: status, folderId: folderId, properties: required };
}

/** Organisations that are Ready (explicitly or by tag) or left In progress. */
function queryAllCandidates(runtime) {
  var out = [];
  var page = 1;
  while (true) {
    var res = capsuleRequest(runtime, 'get', '/parties?perPage=100&embed=tags,fields&page=' + page);
    (res.body.parties || []).forEach(function (p) {
      if (p.type !== 'organisation') return;
      var org = normalizeCapsuleParty(p, runtime);
      var readyNoFolder = org.status === runtime.status.ready && !org.folderId;
      if (readyNoFolder || org.status === runtime.status.inProgress) out.push(p);
    });
    var link = res.headers.Link || res.headers.link || '';
    if (String(link).indexOf('rel="next"') === -1) break;
    page++;
  }
  return out;
}

/** Re-reads one organisation so the run uses its latest values. */
function fetchPage(runtime, partyId) {
  return capsuleRequest(runtime, 'get', '/parties/' + encodeURIComponent(partyId) + '?embed=tags,fields').body.party;
}

// The build*Update helpers return a plain object; updatePage turns it into Capsule fields.
function buildInProgressUpdate(runtime) { return { status: runtime.status.inProgress }; }
function buildFolderLinkUpdate(runtime, folderId) {
  return { status: runtime.status.inProgress, folderId: folderId, folderUrl: folderUrl(folderId) };
}
function buildProvisionedUpdate(runtime, folderId) {
  var u = buildFolderLinkUpdate(runtime, folderId);
  u.status = runtime.status.provisioned;
  return u;
}
function buildRetryUpdate(runtime, message) { return { status: runtime.status.inProgress, note: null, log: message }; }
function buildErrorUpdate(runtime, message) {
  return { status: runtime.status.error, note: 'Drive folder could not be created: ' + truncateMessage(message) };
}

/**
 * Writes the update to the organisation. Existing field values are updated in place;
 * an error is also added as a note on the record so people can see it.
 */
function updatePage(runtime, partyId, update) {
  var defs = fieldDefinitions(runtime);
  var party = fetchPage(runtime, partyId);
  var existing = {};
  (party.fields || []).forEach(function (f) { if (f.definition) existing[f.definition.name] = f.id; });
  var fields = [];
  function set(name, value) {
    if (value === undefined) return;
    fields.push(existing[name] ? { id: existing[name], value: value } : { definition: { id: defs[name] }, value: value });
  }
  set(runtime.properties.driveProvisioning, update.status);
  set(runtime.properties.driveFolderId, update.folderId);
  set(runtime.properties.driveFolderUrl, update.folderUrl);
  capsuleRequest(runtime, 'put', '/parties/' + encodeURIComponent(partyId), { party: { fields: fields } });
  if (update.log) console.log('Retrying ' + partyId + ' next run: ' + update.log);
  if (update.note) {
    capsuleRequest(runtime, 'post', '/entries', { entry: { party: { id: Number(partyId) }, type: 'note', content: update.note } });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    truncateMessage: truncateMessage,
    folderUrl: folderUrl,
    fieldValue: fieldValue,
    normalizeCapsuleParty: normalizeCapsuleParty,
    buildInProgressUpdate: buildInProgressUpdate,
    buildFolderLinkUpdate: buildFolderLinkUpdate,
    buildProvisionedUpdate: buildProvisionedUpdate,
    buildRetryUpdate: buildRetryUpdate,
    buildErrorUpdate: buildErrorUpdate,
  };
}
