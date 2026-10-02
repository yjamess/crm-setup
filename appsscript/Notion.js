// Notion API calls and the JSON bodies those calls send.
// https://developers.notion.com/reference/query-a-data-source

var NOTION_VERSION = '2025-09-03';
var NOTION_API = 'https://api.notion.com/v1';

/**
 * Keeps a Notion error short enough for one rich-text item.
 * @param {string} message
 * @returns {string}
 */
function truncateMessage(message) {
  var text = String(message || 'Unknown error');
  if (text.length <= 500) {
    return text;
  }
  return text.slice(0, 497) + '...';
}

/**
 * @param {string} content Empty content clears the property.
 * @returns {{rich_text: Object[]}}
 */
function richTextProperty(content) {
  if (!content) {
    return { rich_text: [] };
  }
  return {
    rich_text: [{ type: 'text', text: { content: content } }],
  };
}

/**
 * @param {string} folderId
 * @returns {string}
 */
function folderUrl(folderId) {
  return 'https://drive.google.com/drive/folders/' + folderId;
}

/**
 * Pages that are Ready and have no folder yet, plus pages left In progress
 * by a run that stopped halfway.
 * @param {Object} config
 * @returns {Object}
 */
function buildCandidateFilter(config) {
  return {
    page_size: 100,
    filter: {
      or: [
        {
          and: [
            {
              property: config.properties.driveProvisioning,
              type: 'select',
              select: { equals: config.status.ready },
            },
            {
              property: config.properties.driveFolderId,
              type: 'rich_text',
              rich_text: { is_empty: true },
            },
          ],
        },
        {
          property: config.properties.driveProvisioning,
          type: 'select',
          select: { equals: config.status.inProgress },
        },
      ],
    },
  };
}

/**
 * @param {Object} config
 * @returns {Object<string, Object>}
 */
function buildInProgressUpdate(config) {
  var properties = {};
  properties[config.properties.driveProvisioning] = {
    select: { name: config.status.inProgress },
  };
  properties[config.properties.driveError] = richTextProperty('');
  return properties;
}

/**
 * Saves the folder link while subfolders are still being created.
 * Status stays In progress so a retry can finish the row.
 * @param {Object} config
 * @param {string} folderId
 * @returns {Object<string, Object>}
 */
function buildFolderLinkUpdate(config, folderId) {
  var properties = {};
  properties[config.properties.driveProvisioning] = {
    select: { name: config.status.inProgress },
  };
  properties[config.properties.driveFolderId] = richTextProperty(folderId);
  properties[config.properties.driveFolderUrl] = { url: folderUrl(folderId) };
  return properties;
}

/**
 * @param {Object} config
 * @param {string} folderId
 * @param {string} isoDate YYYY-MM-DD in the script time zone.
 * @returns {Object<string, Object>}
 */
function buildProvisionedUpdate(config, folderId, isoDate) {
  var properties = buildFolderLinkUpdate(config, folderId);
  properties[config.properties.driveProvisioning] = {
    select: { name: config.status.provisioned },
  };
  properties[config.properties.driveProvisionedAt] = { date: { start: isoDate } };
  properties[config.properties.driveError] = richTextProperty('');
  return properties;
}

/**
 * Keeps the row In progress after a Drive or Notion failure so the next run retries it.
 * @param {Object} config
 * @param {string} message
 * @returns {Object<string, Object>}
 */
function buildRetryUpdate(config, message) {
  var properties = {};
  properties[config.properties.driveProvisioning] = {
    select: { name: config.status.inProgress },
  };
  properties[config.properties.driveError] = richTextProperty(truncateMessage(message));
  return properties;
}

/**
 * Visible failure. Does not clear a folder ID that was already saved.
 * @param {Object} config
 * @param {string} message
 * @returns {Object<string, Object>}
 */
function buildErrorUpdate(config, message) {
  var properties = {};
  properties[config.properties.driveProvisioning] = {
    select: { name: config.status.error },
  };
  properties[config.properties.driveError] = richTextProperty(truncateMessage(message));
  return properties;
}

/**
 * @returns {string} Today's date in the Apps Script project time zone.
 */
function todayInScriptZone() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * @param {Object} runtime
 * @param {string} method
 * @param {string} path Begins with a slash.
 * @param {Object|undefined} body
 * @returns {Object}
 */
function notionRequest(runtime, method, path, body) {
  var options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + runtime.notionToken,
      'Notion-Version': NOTION_VERSION,
    },
  };
  if (body) {
    options.payload = JSON.stringify(body);
  }
  var response = UrlFetchApp.fetch(NOTION_API + path, options);
  var text = response.getContentText() || '';
  var parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      parsed = { message: text };
    }
  }
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    var detail = parsed.message || text || 'Notion request failed';
    throw new Error('Notion returned ' + status + ': ' + truncateMessage(detail));
  }
  return parsed;
}

/**
 * @param {Object} runtime
 * @returns {Object[]}
 */
function queryAllCandidates(runtime) {
  var pages = [];
  var cursor = '';
  do {
    var body = buildCandidateFilter(runtime);
    if (cursor) {
      body.start_cursor = cursor;
    }
    var response = notionRequest(
      runtime,
      'post',
      '/data_sources/' + encodeURIComponent(runtime.notionDataSourceId) + '/query',
      body
    );
    (response.results || []).forEach(function (page) {
      pages.push(page);
    });
    cursor = response.has_more ? response.next_cursor : '';
  } while (cursor);
  return pages;
}

/**
 * Re-reads one page so the run uses the latest properties, not the query snapshot.
 * @param {Object} runtime
 * @param {string} pageId
 * @returns {Object}
 */
function fetchPage(runtime, pageId) {
  return notionRequest(runtime, 'get', '/pages/' + encodeURIComponent(pageId));
}

/**
 * @param {Object} runtime
 * @param {string} pageId
 * @param {Object<string, Object>} properties
 * @returns {Object}
 */
function updatePage(runtime, pageId, properties) {
  return notionRequest(runtime, 'patch', '/pages/' + encodeURIComponent(pageId), {
    properties: properties,
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NOTION_VERSION: NOTION_VERSION,
    truncateMessage: truncateMessage,
    richTextProperty: richTextProperty,
    folderUrl: folderUrl,
    buildCandidateFilter: buildCandidateFilter,
    buildInProgressUpdate: buildInProgressUpdate,
    buildFolderLinkUpdate: buildFolderLinkUpdate,
    buildProvisionedUpdate: buildProvisionedUpdate,
    buildRetryUpdate: buildRetryUpdate,
    buildErrorUpdate: buildErrorUpdate,
  };
}
