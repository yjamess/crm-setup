const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { CONFIG, SCRIPT_PROPERTY, loadRuntimeConfig } = require('../appsscript/Config');
const {
  folderNameFromOrganisation,
  validateOrganisation,
  readinessProblems,
} = require('../appsscript/Validate');
const {
  normalizeCapsuleParty,
  buildInProgressUpdate,
  buildFolderLinkUpdate,
  buildProvisionedUpdate,
  buildRetryUpdate,
  buildErrorUpdate,
} = require('../appsscript/Capsule');
const {
  escapeDriveQueryValue,
  extractDriveId,
  pageIdQuery,
  nameQuery,
  childrenQuery,
  linkedPageId,
  isMissingFile,
} = require('../appsscript/DriveFolders');

const root = path.join(__dirname, '..');

function confirmedRuntime(overrides) {
  return Object.assign(
    {
      templateConfirmed: true,
      organisationNameProperty: 'name',
      triggerTags: ['Design Partner'],
      googleGroupEmail: 'crm-internal@example.com',
      requiredProperties: ['Company number'],
      properties: CONFIG.properties,
      status: CONFIG.status,
      subfolders: CONFIG.subfolders.slice(),
      environment: 'sandbox',
      capsuleToken: 'test-capsule-token',
      sharedDriveId: 'shared-drive-id',
      parentFolderId: 'parent-folder-id',
    },
    overrides || {}
  );
}

// A Capsule organisation as GET /parties/{id}?embed=tags,fields returns it.
function party(opts) {
  const o = Object.assign({ status: 'Ready', folderId: '', companyNumber: '123', tags: [] }, opts || {});
  const field = (name, value) =>
    value === '' ? null : { id: name.length, definition: { id: 1, name }, value };
  return {
    id: 101,
    type: 'organisation',
    name: 'Acme / North',
    tags: o.tags.map((name) => ({ id: 1, name })),
    fields: [
      field('Drive provisioning', o.status),
      field('Drive folder ID', o.folderId),
      field('Company number', o.companyNumber),
    ].filter(Boolean),
  };
}

describe('confirmed schema gates', () => {
  it('creates the standard organisation subfolders', () => {
    assert.deepEqual(CONFIG.subfolders, [
      {
        name: '01 \u2014 Commercial',
        children: [
          '01 \u2014 Proposals & Pricing',
          '02 \u2014 Contracts',
          '03 \u2014 Purchase Orders & Billing',
        ],
      },
      { name: '02 \u2014 Correspondence & Meetings' },
      { name: '03 \u2014 Data In' },
      { name: '04 \u2014 Delivery & Feedback' },
      { name: '05 \u2014 Files Shared Externally' },
      { name: '99 \u2014 Archive' },
    ]);
  });

  it('refuses an unconfirmed runtime', () => {
    const problems = readinessProblems(
      confirmedRuntime({
        templateConfirmed: false,
        organisationNameProperty: '',
        googleGroupEmail: '',
      })
    );
    assert.ok(problems.some((problem) => problem.includes('templateConfirmed')));
    assert.ok(problems.some((problem) => problem.includes('organisationNameProperty')));
    assert.ok(problems.some((problem) => problem.includes('googleGroupEmail')));
  });

  it('refuses production and a subfolder list that drops the external folder', () => {
    const production = readinessProblems(confirmedRuntime({ environment: 'production' }));
    assert.ok(production.some((problem) => problem.includes('sandbox')));

    const missingFolders = readinessProblems(confirmedRuntime({ subfolders: [] }));
    assert.ok(missingFolders.some((problem) => problem.includes('empty')));
  });

  it('accepts a confirmed sandbox runtime and rejects a repeated subfolder', () => {
    assert.deepEqual(readinessProblems(confirmedRuntime()), []);
    assert.deepEqual(readinessProblems(confirmedRuntime({ sharedDriveId: '' })), []);
    const repeated = readinessProblems(
      confirmedRuntime({
        subfolders: [CONFIG.subfolders[0], CONFIG.subfolders[0]],
      })
    );
    assert.ok(repeated.some((problem) => problem.includes('more than once')));
  });

  it('names the same Script Properties the config object uses', () => {
    const problems = readinessProblems(confirmedRuntime({ capsuleToken: '' }));
    assert.ok(problems.some((problem) => problem.includes(SCRIPT_PROPERTY.capsuleToken)));
    assert.equal(SCRIPT_PROPERTY.capsuleToken, 'CAPSULE_TOKEN');
    assert.equal(SCRIPT_PROPERTY.sharedDriveId, 'SHARED_DRIVE_ID');
    assert.equal(SCRIPT_PROPERTY.parentFolderId, 'PARENT_FOLDER_ID');
    assert.equal(SCRIPT_PROPERTY.environment, 'ENVIRONMENT');
  });

  it('does not read Script Properties outside Apps Script', () => {
    assert.throws(() => loadRuntimeConfig(), /Apps Script/);
  });
});

describe('validateOrganisation', () => {
  const config = confirmedRuntime();

  it('rejects a Ready row that is missing a required field and does not create a name', () => {
    const page = normalizeCapsuleParty(party({ companyNumber: '' }), config);
    const result = validateOrganisation(page, config);
    assert.equal(result.ok, false);
    assert.equal(result.skip, false);
    assert.ok(result.errors.some((error) => error.includes('Company number')));
  });

  it('accepts a complete Ready row and cleans the folder name', () => {
    const page = normalizeCapsuleParty(party(), config);
    const result = validateOrganisation(page, config);
    assert.equal(result.ok, true);
    assert.equal(result.folderName, 'Acme - North');
    assert.equal(page.relationshipStatus, undefined);
  });

  it('ignores relationship status', () => {
    const prospect = normalizeCapsuleParty(party(), config);
    const customer = normalizeCapsuleParty(party(), config);
    prospect.relationshipStatus = 'Prospect';
    customer.relationshipStatus = 'Customer';
    assert.deepEqual(
      validateOrganisation(prospect, config),
      validateOrganisation(customer, config)
    );
  });

  it('skips a Ready row that already has a folder ID', () => {
    const page = normalizeCapsuleParty(party({ folderId: 'folder-1' }), config);
    const result = validateOrganisation(page, config);
    assert.equal(result.skip, true);
    assert.equal(page.folderId, 'folder-1');
  });

  it('allows an In progress row to be recovered when the folder ID is already stored', () => {
    const page = normalizeCapsuleParty(
      party({ status: 'In progress', folderId: 'folder-1' }),
      config
    );
    const result = validateOrganisation(page, config);
    assert.equal(result.ok, true);
    assert.equal(result.folderName, 'Acme - North');
  });

  it('rejects an empty folder name', () => {
    assert.equal(folderNameFromOrganisation('   ').ok, false);
    assert.equal(folderNameFromOrganisation('.').ok, false);
    assert.equal(folderNameFromOrganisation('Acme / North').name, 'Acme - North');
  });
});

describe('Capsule candidates', () => {
  const config = confirmedRuntime();

  it('reads the record ID as a string', () => {
    assert.equal(normalizeCapsuleParty(party(), config).id, '101');
  });

  it('treats a tagged organisation with no status and no folder as Ready', () => {
    const page = normalizeCapsuleParty(party({ status: '', tags: ['Design Partner'] }), config);
    assert.equal(page.status, 'Ready');
    assert.equal(validateOrganisation(page, config).ok, true);
  });

  it('leaves an untagged organisation with no status alone', () => {
    const page = normalizeCapsuleParty(party({ status: '', tags: ['Prospect'] }), config);
    assert.equal(page.status, '');
    assert.equal(validateOrganisation(page, config).skip, true);
  });

  it('lets Not ready block a tagged organisation', () => {
    const page = normalizeCapsuleParty(
      party({ status: 'Not ready', tags: ['Design Partner'] }),
      config
    );
    assert.equal(validateOrganisation(page, config).skip, true);
  });

  it('does not re-trigger a tagged organisation that already has a folder', () => {
    const page = normalizeCapsuleParty(
      party({ status: '', folderId: 'folder-1', tags: ['Design Partner'] }),
      config
    );
    assert.equal(page.status, '');
    assert.equal(validateOrganisation(page, config).skip, true);
  });
});

describe('Capsule payloads', () => {
  const config = confirmedRuntime();

  it('writes the folder link, then the provisioned status', () => {
    assert.deepEqual(buildInProgressUpdate(config), { status: 'In progress' });
    assert.deepEqual(buildFolderLinkUpdate(config, 'folder-1'), {
      status: 'In progress',
      folderId: 'folder-1',
      folderUrl: 'https://drive.google.com/drive/folders/folder-1',
    });
    assert.equal(buildProvisionedUpdate(config, 'folder-1').status, 'Provisioned');
  });

  it('records an error as a note without clearing the folder ID', () => {
    const errorUpdate = buildErrorUpdate(config, 'x'.repeat(800));
    assert.deepEqual(Object.keys(errorUpdate).sort(), ['note', 'status']);
    assert.equal(errorUpdate.status, 'Error');
    assert.ok(errorUpdate.note.startsWith('Drive folder could not be created: '));
    assert.ok(errorUpdate.note.length < 600);

    const retry = buildRetryUpdate(config, 'Drive timeout', false);
    assert.equal(retry.status, 'In progress');
    assert.equal(retry.folderId, undefined);
    assert.equal(retry.note, null);
  });

  it('adds a note on the first Drive failure only', () => {
    const first = buildRetryUpdate(config, 'Drive timeout', true);
    assert.equal(first.status, 'In progress');
    assert.ok(first.note.startsWith('Drive folder is not finished yet: Drive timeout'));
    assert.equal(buildRetryUpdate(config, 'Drive timeout', false).note, null);
  });
});

describe('Drive identity', () => {
  const runtime = confirmedRuntime({ parentFolderId: "parent'1" });

  it('reads a folder ID from a Drive link', () => {
    assert.equal(
      extractDriveId(
        'https://drive.google.com/drive/u/2/folders/1xihtBUKbVV42GzgRlHp3PlaggtUv6eFV'
      ),
      '1xihtBUKbVV42GzgRlHp3PlaggtUv6eFV'
    );
    assert.equal(
      extractDriveId('u/2/1xihtBUKbVV42GzgRlHp3PlaggtUv6eFV'),
      '1xihtBUKbVV42GzgRlHp3PlaggtUv6eFV'
    );
    assert.equal(extractDriveId('0ArealDriveId'), '0ArealDriveId');
  });

  it('escapes quotes in the page-ID and name searches', () => {
    assert.equal(escapeDriveQueryValue("O'Brien\\North"), "O\\'Brien\\\\North");
    const byId = pageIdQuery(runtime, 'page-1');
    assert.match(byId, /appProperties has \{ key='capsulePartyId' and value='page-1' \}/);
    assert.match(byId, /'parent\\'1' in parents/);
    const byName = nameQuery(runtime, "O'Brien");
    assert.match(byName, /name = 'O\\'Brien'/);
    assert.equal(
      childrenQuery("child'1"),
      "'child\\'1' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
  });

  it('reads the linked page ID only from appProperties', () => {
    assert.equal(linkedPageId({ description: 'capsulePartyId: page-1' }), '');
    assert.equal(
      linkedPageId({ appProperties: { capsulePartyId: 'page-1' } }),
      'page-1'
    );
    assert.equal(isMissingFile({ message: 'File not found: 404' }), true);
    assert.equal(isMissingFile({ message: 'Rate Limit Exceeded' }), false);
  });

  it('does not call the Drive permissions API', () => {
    ['DriveFolders.js', 'Provision.js', 'Capsule.js', 'Main.js'].forEach((fileName) => {
      const source = fs.readFileSync(path.join(root, 'appsscript', fileName), 'utf8');
      assert.equal(source.includes('permissions.create'), false, fileName);
      assert.equal(source.includes('Permissions'), false, fileName);
    });
  });
});
