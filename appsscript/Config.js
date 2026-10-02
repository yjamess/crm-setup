// Shared settings for the organisation-folder script.
//
// `var` is required. In the Apps Script V8 runtime, `const` and `let` at the
// top of a file stay in that file. `var` is visible to the other files.
// https://developers.google.com/apps-script/guides/v8-runtime#global_scope
//
// Leave the blank confirmation fields blank until a person checks them.
// readinessProblems() refuses to create folders while they are blank.
var CONFIG = {
  // Set this to true only after subfolders lists every standard folder.
  templateConfirmed: true,

  organisationNameProperty: 'Company Name',


  relationshipStatusProperty: '',

  // The internal group that should be a member of the Shared drive.
  // The script does not call the Drive permissions API.
  googleGroupEmail: 'yetty@bite.engineering',

  // Extra Companies fields that must be filled before a folder is created.
  // The organisation name is always required, even when this list is empty.
  requiredProperties: [],

  properties: {
    driveProvisioning: 'Drive provisioning',
    driveFolderId: 'Drive folder ID',
    driveFolderUrl: 'Drive folder URL',
    driveProvisionedAt: 'Drive provisioned at',
    driveError: 'Drive error',
  },

  status: {
    notReady: 'Not ready',
    ready: 'Ready',
    inProgress: 'In progress',
    provisioned: 'Provisioned',
    error: 'Error',
  },

  
  // A children list is created inside that folder. Other entries sit directly in the company folder.
  subfolders: [
    {
      name: '01 — Commercial',
      children: [
        '01 — Proposals & Pricing',
        '02 — Contracts',
        '03 — Purchase Orders & Billing',
      ],
    },
    { name: '02 — Correspondence & Meetings' },
    { name: '03 — Data In' },
    { name: '04 — Delivery & Feedback' },
    { name: '05 — Files Shared Externally' },
    { name: '99 — Archive' },
  ],
};

// Script Property names. Values live in the Apps Script project, not in git.
var SCRIPT_PROPERTY = {
  environment: 'ENVIRONMENT',
  notionToken: 'NOTION_TOKEN',
  notionDataSourceId: 'NOTION_DATA_SOURCE_ID',
  sharedDriveId: 'SHARED_DRIVE_ID',
  parentFolderId: 'PARENT_FOLDER_ID',
};

/**
 * Reads secrets and IDs from Script Properties and combines them with CONFIG.
 * Call this only inside Apps Script.
 * @returns {Object} runtime settings for one provisioning run
 */
function loadRuntimeConfig() {
  if (typeof PropertiesService === 'undefined') {
    throw new Error('Script Properties are only available inside Apps Script.');
  }
  var stored = PropertiesService.getScriptProperties();
  return {
    templateConfirmed: CONFIG.templateConfirmed,
    organisationNameProperty: CONFIG.organisationNameProperty,
    relationshipStatusProperty: CONFIG.relationshipStatusProperty,
    googleGroupEmail: CONFIG.googleGroupEmail,
    requiredProperties: CONFIG.requiredProperties.slice(),
    properties: {
      driveProvisioning: CONFIG.properties.driveProvisioning,
      driveFolderId: CONFIG.properties.driveFolderId,
      driveFolderUrl: CONFIG.properties.driveFolderUrl,
      driveProvisionedAt: CONFIG.properties.driveProvisionedAt,
      driveError: CONFIG.properties.driveError,
    },
    status: {
      notReady: CONFIG.status.notReady,
      ready: CONFIG.status.ready,
      inProgress: CONFIG.status.inProgress,
      provisioned: CONFIG.status.provisioned,
      error: CONFIG.status.error,
    },
    subfolders: CONFIG.subfolders.slice(),
    environment: stored.getProperty(SCRIPT_PROPERTY.environment) || '',
    notionToken: stored.getProperty(SCRIPT_PROPERTY.notionToken) || '',
    notionDataSourceId: stored.getProperty(SCRIPT_PROPERTY.notionDataSourceId) || '',
    sharedDriveId: stored.getProperty(SCRIPT_PROPERTY.sharedDriveId) || '',
    parentFolderId: stored.getProperty(SCRIPT_PROPERTY.parentFolderId) || '',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG: CONFIG,
    SCRIPT_PROPERTY: SCRIPT_PROPERTY,
    loadRuntimeConfig: loadRuntimeConfig,
  };
}
