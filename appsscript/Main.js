// Run provisionReadyOrganisations by hand, or every five minutes from a trigger.
// The function returns immediately until the confirmation fields and sandbox
// Script Properties are filled in.

/**
 * Looks for Companies rows that are Ready or In progress and provisions folders.
 * Safe to run twice: a row that already has a linked folder is not duplicated.
 */
function provisionReadyOrganisations() {
  var runtime = loadRuntimeConfig();
  var problems = readinessProblems(runtime);
  if (problems.length) {
    console.log('Provisioning did not run. ' + problems.join(' '));
    return;
  }
  provisionAll(runtime);
}

/**
 * Prints the Companies data source ID. Set NOTION_TOKEN and NOTION_DATABASE_ID
 * in Script Properties first. NOTION_DATABASE_ID is only used by this helper.
 * https://developers.notion.com/reference/retrieve-a-database
 */
function logDataSourceIds() {
  var stored = PropertiesService.getScriptProperties();
  var token = stored.getProperty(SCRIPT_PROPERTY.notionToken) || '';
  var databaseId = stored.getProperty('NOTION_DATABASE_ID') || '';
  if (!token || !databaseId) {
    console.log(
      'Set Script Properties NOTION_TOKEN and NOTION_DATABASE_ID, then run logDataSourceIds again.'
    );
    return;
  }
  var response = UrlFetchApp.fetch(
    NOTION_API + '/databases/' + encodeURIComponent(databaseId),
    {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': NOTION_VERSION,
      },
    }
  );
  var text = response.getContentText() || '';
  var parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.log('Notion did not return JSON. Status ' + response.getResponseCode());
    return;
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    console.log('Notion returned ' + response.getResponseCode() + ': ' + (parsed.message || ''));
    return;
  }
  var sources = parsed.data_sources || [];
  if (!sources.length) {
    console.log('This database did not include a data source ID.');
    return;
  }
  sources.forEach(function (source) {
    console.log((source.name || 'Data source') + ': ' + source.id);
  });
  console.log('Copy the ID into the Script Property NOTION_DATA_SOURCE_ID.');
}
