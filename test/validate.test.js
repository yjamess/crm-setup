const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { CONFIG, SCRIPT_PROPERTY, loadRuntimeConfig } = require('../appsscript/Config');
const {
  normalizeNotionPage,
  folderNameFromOrganisation,
  validateOrganisation,
  readinessProblems,
} = require('../appsscript/Validate');
const {
  buildCandidateFilter,
  buildInProgressUpdate,
  buildFolderLinkUpdate,
  buildProvisionedUpdate,
  buildRetryUpdate,
  buildErrorUpdate,
  truncateMessage,
} = require('../appsscript/Notion');
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
      organisationNameProperty: 'Name',
      relationshipStatusProperty: '',
      googleGroupEmail: 'crm-internal@example.com',
      requiredProperties: ['Company number'],
      properties: CONFIG.properties,
      status: CONFIG.status,
      subfolders: CONFIG.subfolders.slice(),
      environment: 'sandbox',
      notionToken: 'test-notion-token',
      notionDataSourceId: 'data-source-id',
      sharedDriveId: 'shared-drive-id',
      parentFolderId: 'parent-folder-id',
    },
    overrides || {}
  );
}

function apiPage(status, extras) {
  const properties = {
    Name: { type: 'title', title: [{ plain_text: 'Acme / North' }] },
    'Drive provisioning': { type: 'select', select: { name: status } },
    'Drive folder ID': { type: 'rich_text', rich_text: [] },
    'Company number': { type: 'rich_text', rich_text: [{ plain_text: '123' }] },
    'Relationship status': { type: 'select', select: { name: 'Prospect' } },
  };
  return {
    id: 'page-1',
    properties: Object.assign(properties, (extras && extras.properties) || {}),
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

  it('refuses an unconfirmed runtime and allows a blank relationship-status name', () => {
    const problems = readinessProblems(
      confirmedRuntime({
        templateConfirmed: false,
        organisationNameProperty: '',
        relationshipStatusProperty: '',
        googleGroupEmail: '',
      })
    );
    assert.ok(problems.some((problem) => problem.includes('templateConfirmed')));
    assert.ok(problems.some((problem) => problem.includes('organisationNameProperty')));
    assert.ok(problems.some((problem) => problem.includes('googleGroupEmail')));
    assert.equal(
      problems.some((problem) => problem.includes('relationshipStatusProperty')),
      false
    );
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
    const problems = readinessProblems(confirmedRuntime({ notionToken: '' }));
    assert.ok(problems.some((problem) => problem.includes(SCRIPT_PROPERTY.notionToken)));
    assert.equal(SCRIPT_PROPERTY.notionDataSourceId, 'NOTION_DATA_SOURCE_ID');
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
    const page = normalizeNotionPage(
      apiPage('Ready', {
        properties: {
          'Company number': { type: 'rich_text', rich_text: [] },
        },
      }),
      config
    );
    const result = validateOrganisation(page, config);
    assert.equal(result.ok, false);
    assert.equal(result.skip, false);
    assert.ok(result.errors.some((error) => error.includes('Company number')));
  });

  it('accepts a complete Ready row and cleans the folder name', () => {
    const page = normalizeNotionPage(apiPage('Ready'), config);
    const result = validateOrganisation(page, config);
    assert.equal(result.ok, true);
    assert.equal(result.folderName, 'Acme - North');
    assert.equal(page.relationshipStatus, undefined);
  });

  it('ignores relationship status', () => {
    const prospect = normalizeNotionPage(apiPage('Ready'), config);
    const customer = normalizeNotionPage(apiPage('Ready'), config);
    prospect.relationshipStatus = 'Prospect';
    customer.relationshipStatus = 'Customer';
    assert.deepEqual(
      validateOrganisation(prospect, config),
      validateOrganisation(customer, config)
    );
  });

  it('skips a Ready row that already has a folder ID', () => {
    const page = normalizeNotionPage(
      apiPage('Ready', {
        properties: {
          'Drive folder ID': { type: 'rich_text', rich_text: [{ plain_text: 'folder-1' }] },
        },
      }),
      config
    );
    const result = validateOrganisation(page, config);
    assert.equal(result.skip, true);
    assert.equal(page.folderId, 'folder-1');
  });

  it('allows an In progress row to be recovered when the folder ID is already stored', () => {
    const page = normalizeNotionPage(
      apiPage('In progress', {
        properties: {
          'Drive folder ID': { type: 'rich_text', rich_text: [{ plain_text: 'folder-1' }] },
        },
      }),
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

describe('Notion payloads', () => {
  const config = confirmedRuntime();

  it('asks only for Ready rows with an empty folder ID, plus In progress rows', () => {
    const filter = buildCandidateFilter(config);
    const encoded = JSON.stringify(filter);
    assert.equal(filter.filter.or[0].and[0].select.equals, 'Ready');
    assert.equal(filter.filter.or[0].and[1].rich_text.is_empty, true);
    assert.equal(filter.filter.or[1].select.equals, 'In progress');
    assert.equal(encoded.includes('Relationship'), false);
    assert.equal(encoded.includes('Provisioned'), false);
  });

  it('writes the folder link, then the provisioned status, without sharing fields', () => {
    const link = buildFolderLinkUpdate(config, 'folder-1');
    assert.equal(link['Drive provisioning'].select.name, 'In progress');
    assert.equal(link['Drive folder ID'].rich_text[0].text.content, 'folder-1');
    assert.equal(link['Drive folder URL'].url, 'https://drive.google.com/drive/folders/folder-1');

    const done = buildProvisionedUpdate(config, 'folder-1', '2026-10-02');
    assert.equal(done['Drive provisioning'].select.name, 'Provisioned');
    assert.equal(done['Drive provisioned at'].date.start, '2026-10-02');
    assert.deepEqual(done['Drive error'].rich_text, []);

    const claimed = buildInProgressUpdate(config);
    assert.equal(claimed['Drive provisioning'].select.name, 'In progress');
    assert.deepEqual(claimed['Drive error'].rich_text, []);
  });

  it('records a visible error without clearing the folder ID', () => {
    const errorUpdate = buildErrorUpdate(config, 'A folder named "Acme" already exists.');
    assert.deepEqual(Object.keys(errorUpdate).sort(), ['Drive error', 'Drive provisioning']);
    assert.equal(errorUpdate['Drive provisioning'].select.name, 'Error');

    const retry = buildRetryUpdate(config, 'x'.repeat(800));
    assert.equal(retry['Drive provisioning'].select.name, 'In progress');
    assert.equal(retry['Drive error'].rich_text[0].text.content, truncateMessage('x'.repeat(800)));
    assert.equal(retry['Drive error'].rich_text[0].text.content.length, 500);
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
    assert.match(byId, /appProperties has \{ key='notionPageId' and value='page-1' \}/);
    assert.match(byId, /'parent\\'1' in parents/);
    const byName = nameQuery(runtime, "O'Brien");
    assert.match(byName, /name = 'O\\'Brien'/);
    assert.equal(
      childrenQuery("child'1"),
      "'child\\'1' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
  });

  it('reads the linked page ID only from appProperties', () => {
    assert.equal(linkedPageId({ description: 'notionPageId: page-1' }), '');
    assert.equal(
      linkedPageId({ appProperties: { notionPageId: 'page-1' } }),
      'page-1'
    );
    assert.equal(isMissingFile({ message: 'File not found: 404' }), true);
    assert.equal(isMissingFile({ message: 'Rate Limit Exceeded' }), false);
  });

  it('does not call the Drive permissions API', () => {
    ['DriveFolders.js', 'Provision.js', 'Notion.js', 'Main.js'].forEach((fileName) => {
      const source = fs.readFileSync(path.join(root, 'appsscript', fileName), 'utf8');
      assert.equal(source.includes('permissions.create'), false, fileName);
      assert.equal(source.includes('Permissions'), false, fileName);
    });
  });
});
