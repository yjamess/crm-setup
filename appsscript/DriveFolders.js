// Shared-drive folders. This file never changes sharing permissions.
// https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
// https://developers.google.com/apps-script/advanced/drive

/**
 * Escapes a value for a Drive search query wrapped in single quotes.
 * https://developers.google.com/workspace/drive/api/guides/search-files
 * @param {string} value
 * @returns {string}
 */
function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Keeps the Drive ID when a Script Property contains a browser link or a
 * "u/2/" account prefix. Shared drive lookup uses driveId on the folder,
 * not the folder ID itself.
 * https://developers.google.com/workspace/drive/api/reference/rest/v3/files
 * @param {string} value
 * @returns {string}
 */
function extractDriveId(value) {
  var text = String(value || '').trim();
  var fromUrl = text.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) {
    return fromUrl[1];
  }
  var fromAccountPrefix = text.match(/^(?:u\/\d+\/)?([a-zA-Z0-9_-]+)$/);
  if (fromAccountPrefix) {
    return fromAccountPrefix[1];
  }
  return text;
}

/**
 * A folder ID is not a Shared drive ID. Read the drive from the parent folder.
 * @param {Object} runtime
 */
function resolveSharedDrive(runtime) {
  runtime.parentFolderId = extractDriveId(runtime.parentFolderId);
  var folder = Drive.Files.get(runtime.parentFolderId, {
    supportsAllDrives: true,
    fields: 'id, name, driveId',
  });
  if (!folder || !folder.id) {
    throw new Error('PARENT_FOLDER_ID does not point at a folder this account can open.');
  }
  if (folder.driveId) {
    runtime.sharedDriveId = folder.driveId;
    console.log('Using Shared drive ' + runtime.sharedDriveId + ' for folder ' + folder.name);
    return;
  }
  runtime.sharedDriveId = '';
  console.log('Using shared folder "' + folder.name + '" (' + folder.id + ').');
}

/**
 * @param {Object} runtime
 * @param {string} pageId
 * @returns {string}
 */
function pageIdQuery(runtime, pageId) {
  return (
    "appProperties has { key='capsulePartyId' and value='" +
    escapeDriveQueryValue(pageId) +
    "' } and mimeType = 'application/vnd.google-apps.folder' and '" +
    escapeDriveQueryValue(runtime.parentFolderId) +
    "' in parents and trashed = false"
  );
}

/**
 * @param {Object} runtime
 * @param {string} folderName Already cleaned by folderNameFromOrganisation.
 * @returns {string}
 */
function nameQuery(runtime, folderName) {
  return (
    "name = '" +
    escapeDriveQueryValue(folderName) +
    "' and mimeType = 'application/vnd.google-apps.folder' and '" +
    escapeDriveQueryValue(runtime.parentFolderId) +
    "' in parents and trashed = false"
  );
}

/**
 * @param {string} folderId
 * @returns {string}
 */
function childrenQuery(folderId) {
  return (
    "'" +
    escapeDriveQueryValue(folderId) +
    "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  );
}

/**
 * @param {Object|undefined} folder
 * @returns {string}
 */
function linkedPageId(folder) {
  if (!folder || !folder.appProperties || !folder.appProperties.capsulePartyId) {
    return '';
  }
  return String(folder.appProperties.capsulePartyId);
}

/**
 * @param {Object} err
 * @returns {boolean}
 */
function isMissingFile(err) {
  var message = String(err && err.message ? err.message : err);
  return (
    message.indexOf('404') !== -1 ||
    message.indexOf('File not found') !== -1 ||
    message.indexOf('notFound') !== -1
  );
}

/**
 * @param {Object} runtime
 * @param {string} query
 * @returns {Object[]}
 */
function listFolders(runtime, query) {
  var files = [];
  var pageToken = '';
  do {
    var options = {
      q: query,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 100,
      fields: 'nextPageToken, files(id, name, trashed, appProperties, parents)',
    };
    if (runtime.sharedDriveId) {
      options.corpora = 'drive';
      options.driveId = runtime.sharedDriveId;
    }
    if (pageToken) {
      options.pageToken = pageToken;
    }
    var response = Drive.Files.list(options);
    (response.files || []).forEach(function (file) {
      if (!file.trashed) {
        files.push(file);
      }
    });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return files;
}

/**
 * @param {Object} runtime
 * @param {string} folderId
 * @returns {Object|null}
 */
function getFolder(runtime, folderId) {
  try {
    var folder = Drive.Files.get(folderId, {
      supportsAllDrives: true,
      fields: 'id, name, trashed, appProperties, parents',
    });
    if (!folder || folder.trashed) {
      return null;
    }
    return folder;
  } catch (err) {
    if (isMissingFile(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * The second argument is null because a folder has no file bytes.
 * Passing the options object in that position makes Apps Script treat it as a file upload.
 * @param {Object} resource
 * @returns {Object}
 */
function createDriveFolder(resource) {
  var created = Drive.Files.create(resource, null, {
    supportsAllDrives: true,
    fields: 'id, name, appProperties',
  });
  if (!created || !created.id) {
    throw new Error('Drive did not return an ID for the new folder.');
  }
  return created;
}

/**
 * @param {Object} runtime
 * @param {string} folderName
 * @param {string} pageId
 * @returns {Object}
 */
function createOrganisationFolder(runtime, folderName, pageId) {
  return createDriveFolder({
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [runtime.parentFolderId],
    description: 'capsulePartyId: ' + pageId,
    appProperties: {
      capsulePartyId: pageId,
      provisionedBy: 'crm-setup',
    },
  });
}

/**
 * Subfolders do not store the Capsule record ID. A later search by that ID
 * must find the organisation folder, not a child folder.
 * @param {string} parentId
 * @param {string} name
 * @returns {Object}
 */
function createSubfolder(parentId, name) {
  return createDriveFolder({
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  });
}

/**
 * Finds the organisation folder, or creates it when no linked folder exists.
 * A hand-made folder with the same name is left alone.
 * @param {Object} runtime
 * @param {Object} page
 * @returns {{action: 'ready', folderId: string}|{action: 'error', message: string}}
 */
function locateOrCreateOrganisationFolder(runtime, page) {
  var naming = folderNameFromOrganisation(page.name);
  if (!naming.ok) {
    return { action: 'error', message: naming.error };
  }

  if (page.folderId) {
    var stored = getFolder(runtime, page.folderId);
    if (!stored) {
      return {
        action: 'error',
        message:
          'The Drive folder ID on this record does not point at a folder. No new folder was created. Clear Drive folder ID only when you mean to provision a new one, then set Drive provisioning back to Ready.',
      };
    }
    if (linkedPageId(stored) !== page.id) {
      return {
        action: 'error',
        message:
          'The Drive folder ID on this record is not linked to this Capsule record. No folder was created. Clear Drive folder ID only when you mean to provision a new one, then set Drive provisioning back to Ready.',
      };
    }
    return { action: 'ready', folderId: stored.id };
  }

  var byId = listFolders(runtime, pageIdQuery(runtime, page.id));
  if (byId.length > 1) {
    return {
      action: 'error',
      message:
        'More than one Drive folder is already linked to this Capsule record. No new folder was created.',
    };
  }
  if (byId.length === 1) {
    return { action: 'ready', folderId: byId[0].id };
  }

  var byName = listFolders(runtime, nameQuery(runtime, naming.name));
  var linkedByName = byName.filter(function (folder) {
    return linkedPageId(folder) === page.id;
  });
  if (linkedByName.length === 1) {
    return { action: 'ready', folderId: linkedByName[0].id };
  }
  if (linkedByName.length > 1) {
    return {
      action: 'error',
      message:
        'More than one Drive folder is already linked to this Capsule record. No new folder was created.',
    };
  }
  if (byName.length) {
    return {
      action: 'error',
      message:
        'A folder named "' +
        naming.name +
        '" already exists and is not linked to this record. No folder was created. Rename or remove that folder, then set Drive provisioning back to Ready.',
    };
  }

  var created = createOrganisationFolder(runtime, naming.name, page.id);
  return { action: 'ready', folderId: created.id };
}

/**
 * Creates any missing folder from the template. Children are created inside their parent.
 * Existing folders are left in place.
 * @param {Object} runtime
 * @param {string} organisationFolderId
 */
function ensureSubfolders(runtime, organisationFolderId) {
  ensureChildFolders(runtime, organisationFolderId, runtime.subfolders || []);
}

/**
 * @param {Object} runtime
 * @param {string} parentId
 * @param {Array<string|Object>} entries
 */
function ensureChildFolders(runtime, parentId, entries) {
  var existing = listFolders(runtime, childrenQuery(parentId));
  var idsByName = {};
  existing.forEach(function (folder) {
    idsByName[folder.name] = folder.id;
  });
  entries.forEach(function (entry) {
    var folderName = subfolderName(entry);
    if (!folderName) {
      return;
    }
    var folderId = idsByName[folderName];
    if (!folderId) {
      folderId = createSubfolder(parentId, folderName).id;
      idsByName[folderName] = folderId;
    }
    var children = subfolderChildren(entry);
    if (children.length) {
      ensureChildFolders(runtime, folderId, children);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeDriveQueryValue: escapeDriveQueryValue,
    extractDriveId: extractDriveId,
    pageIdQuery: pageIdQuery,
    nameQuery: nameQuery,
    childrenQuery: childrenQuery,
    linkedPageId: linkedPageId,
    isMissingFile: isMissingFile,
  };
}
