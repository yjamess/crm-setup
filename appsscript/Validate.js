// Pure checks. This file does not call Capsule or Drive, so Node can test it.

/**
 * Makes an organisation name safe to use as a Drive folder name.
 * Drive folder names cannot contain a slash.
 * @param {string} name
 * @returns {{ok: true, name: string}|{ok: false, error: string}}
 */
function folderNameFromOrganisation(name) {
  var cleaned = String(name || '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return {
      ok: false,
      error:
        'Organisation name is empty after removing characters Drive cannot use in a folder name.',
    };
  }
  return { ok: true, name: cleaned };
}

/**
 * Decides whether one Capsule organisation may get a folder.
 * A skip is not a failure: the row is left unchanged.
 * @param {Object} page Result of normalizeCapsuleParty, plus an optional relationshipStatus field that is ignored.
 * @param {Object} config
 * @returns {{ok: boolean, skip: boolean, reason?: string, errors?: string[], folderName?: string}}
 */
function validateOrganisation(page, config) {
  var status = page.status || '';
  if (status !== config.status.ready && status !== config.status.inProgress) {
    return {
      ok: false,
      skip: true,
      reason: 'Drive provisioning is not Ready or In progress.',
    };
  }
  if (status === config.status.ready && page.folderId) {
    return {
      ok: false,
      skip: true,
      reason: 'This record already has a Drive folder ID.',
    };
  }

  var errors = [];
  if (!page.id) {
    errors.push('Capsule record ID is missing.');
  }
  var naming = folderNameFromOrganisation(page.name);
  if (!naming.ok) {
    errors.push(naming.error);
  }
  (config.requiredProperties || []).forEach(function (propertyName) {
    var value = page.properties ? page.properties[propertyName] : '';
    if (!value) {
      errors.push('Required field "' + propertyName + '" is empty.');
    }
  });
  if (errors.length) {
    return { ok: false, skip: false, errors: errors };
  }
  return { ok: true, skip: false, folderName: naming.name };
}

/**
 * @param {string|Object} entry
 * @returns {string}
 */
function subfolderName(entry) {
  if (typeof entry === 'string') {
    return String(entry || '').trim();
  }
  return entry && entry.name ? String(entry.name).trim() : '';
}

/**
 * @param {string|Object} entry
 * @returns {string[]}
 */
function subfolderChildren(entry) {
  var children = entry && entry.children ? entry.children : [];
  return children.map(function (childName) {
    return String(childName || '').trim();
  });
}

/**
 * Reasons the whole run must stop before it touches Capsule or Drive.
 * Production IDs are refused in this phase even if every other value is set.
 * @param {Object} runtime
 * @returns {string[]}
 */
function readinessProblems(runtime) {
  var problems = [];
  var settings = runtime || {};
  if (settings.environment !== 'sandbox') {
    problems.push(
      'ENVIRONMENT must be sandbox. Production is not enabled in this phase.'
    );
  }
  if (settings.templateConfirmed !== true) {
    problems.push(
      'Set templateConfirmed to true in Config.js after the full subfolder list is confirmed.'
    );
  }
  if (!String(settings.organisationNameProperty || '').trim()) {
    problems.push(
      'organisationNameProperty is empty in loadRuntimeConfig (Config.js).'
    );
  }
  if (!String(settings.googleGroupEmail || '').includes('@')) {
    problems.push(
      'Set googleGroupEmail in Config.js to the email address of the internal group that is a member of the Shared drive.'
    );
  }

  var subfolders = settings.subfolders || [];
  if (!subfolders.length) {
    problems.push('The subfolder list is empty.');
  }
  var seen = {};
  subfolders.forEach(function (entry) {
    var name = subfolderName(entry);
    if (!name) {
      problems.push('The subfolder list contains an empty name.');
      return;
    }
    if (seen[name]) {
      problems.push('Subfolder "' + name + '" is listed more than once.');
    }
    seen[name] = true;
    var childSeen = {};
    subfolderChildren(entry).forEach(function (childName) {
      if (!childName) {
        problems.push('A folder inside "' + name + '" has an empty name.');
        return;
      }
      if (childSeen[childName]) {
        problems.push(
          'Subfolder "' + childName + '" is listed more than once inside "' + name + '".'
        );
      }
      childSeen[childName] = true;
    });
  });

  // These names must stay the same as SCRIPT_PROPERTY in Config.js.
  [
    ['capsuleToken', 'CAPSULE_TOKEN'],
    ['parentFolderId', 'PARENT_FOLDER_ID'],
  ].forEach(function (pair) {
    if (!String(settings[pair[0]] || '').trim()) {
      problems.push('Script Property ' + pair[1] + ' is empty.');
    }
  });
  return problems;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    folderNameFromOrganisation: folderNameFromOrganisation,
    subfolderName: subfolderName,
    subfolderChildren: subfolderChildren,
    validateOrganisation: validateOrganisation,
    readinessProblems: readinessProblems,
  };
}
