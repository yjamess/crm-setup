// Shared settings for the organisation-folder script (Capsule version).
//
// `var` is required. In the Apps Script V8 runtime, `const` and `let` at the
// top of a file stay in that file. `var` is visible to the other files.

var CONFIG = {
  templateConfirmed: true,

  // An organisation gets a folder when Drive provisioning is set to Ready,
  // or when it carries one of these tags and has no folder yet.
  // Setting Drive provisioning to "Not ready" blocks a tagged organisation.
  triggerTags: ['Design Partner'],

  // Must be a member of the Shared drive. The script does not call the permissions API.
  googleGroupEmail: 'yetty@bite.engineering',

  // Capsule organisation fields that must be filled before a folder is created.
  requiredProperties: [],

  // Capsule custom field names (organisation fields).
  properties: {
    driveProvisioning: 'Drive provisioning',
    driveFolderId: 'Drive folder ID',
    driveFolderUrl: 'Drive folder URL',
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
      children: ['01 — Proposals & Pricing', '02 — Contracts', '03 — Purchase Orders & Billing'],
    },
    { name: '02 — Correspondence & Meetings' },
    { name: '03 — Data In' },
    { name: '04 — Delivery & Feedback' },
    { name: '05 — Files Shared Externally' },
    { name: '99 — Archive' },
  ],
};

// Script Property names. Values live in the Apps Script project, not in code.
var SCRIPT_PROPERTY = {
  environment: 'ENVIRONMENT',
  capsuleToken: 'CAPSULE_TOKEN',
  sharedDriveId: 'SHARED_DRIVE_ID',
  parentFolderId: 'PARENT_FOLDER_ID',
};

/**
 * Reads secrets and IDs from Script Properties and combines them with CONFIG.
 * @returns {Object} runtime settings for one provisioning run
 */
function loadRuntimeConfig() {
  if (typeof PropertiesService === 'undefined') {
    throw new Error('Script Properties are only available inside Apps Script.');
  }
  var stored = PropertiesService.getScriptProperties();
  return {
    templateConfirmed: CONFIG.templateConfirmed,
    organisationNameProperty: 'name',
    triggerTags: CONFIG.triggerTags.slice(),
    googleGroupEmail: CONFIG.googleGroupEmail,
    requiredProperties: CONFIG.requiredProperties.slice(),
    properties: CONFIG.properties,
    status: CONFIG.status,
    subfolders: CONFIG.subfolders.slice(),
    environment: stored.getProperty(SCRIPT_PROPERTY.environment) || '',
    capsuleToken: stored.getProperty(SCRIPT_PROPERTY.capsuleToken) || '',
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
