// Claims one Capsule row, creates its folder, and writes the result back.
// One failing row does not stop the others.
// Relationship status is not read. Changing it does not move or recreate a folder.

/**
 * @param {Object} runtime
 * @param {string} pageId
 * @param {string} message
 */
function markError(runtime, pageId, message) {
  try {
    updatePage(runtime, pageId, buildErrorUpdate(runtime, message));
  } catch (writeError) {
    console.log(
      'Could not record the Capsule error on ' + pageId + ': ' + writeError.message
    );
  }
}

/**
 * Leaves the row In progress and stores the message, so the next run can retry.
 * @param {Object} runtime
 * @param {string} pageId
 * @param {string} message
 * @param {boolean} firstFailure True when the run started from Ready, not In progress.
 */
function markStillInProgress(runtime, pageId, message, firstFailure) {
  try {
    updatePage(runtime, pageId, buildRetryUpdate(runtime, message, firstFailure));
  } catch (writeError) {
    console.log(
      'Could not record the Drive error on ' + pageId + ': ' + writeError.message
    );
  }
}

/**
 * @param {Object} runtime
 * @param {string} pageId
 */
function provisionOne(runtime, pageId) {
  var page = normalizeCapsuleParty(fetchPage(runtime, pageId), runtime);
  var check = validateOrganisation(page, runtime);
  if (check.skip) {
    console.log('Skipped ' + (page.id || pageId) + ': ' + check.reason);
    return;
  }
  if (!check.ok) {
    markError(runtime, page.id || pageId, check.errors.join(' '));
    return;
  }

  if (page.status === runtime.status.ready) {
    updatePage(runtime, page.id, buildInProgressUpdate(runtime));
  }

  var located = locateOrCreateOrganisationFolder(runtime, page);
  if (located.action === 'error') {
    markError(runtime, page.id, located.message);
    return;
  }

  // Save the folder ID before creating subfolders. A retry can then finish
  // this same folder instead of searching for a folder Drive has not indexed yet.
  updatePage(runtime, page.id, buildFolderLinkUpdate(runtime, located.folderId));
  ensureSubfolders(runtime, located.folderId);
  updatePage(
    runtime,
    page.id,
    buildProvisionedUpdate(runtime, located.folderId, todayInScriptZone())
  );
}

/**
 * Poll entry point used by the time-driven trigger.
 * @param {Object} runtime
 */
function provisionAll(runtime) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('Another provisioning run is still going, so this one stopped.');
    return;
  }
  try {
    try {
      resolveSharedDrive(runtime);
    } catch (err) {
      console.log(err.message);
      return;
    }
    var seen = {};
    queryAllCandidates(runtime).forEach(function (candidate) {
      var pageId = candidate.id;
      if (!pageId || seen[pageId]) {
        return;
      }
      seen[pageId] = true;
      try {
        provisionOne(runtime, pageId);
      } catch (err) {
        console.log('Provisioning failed for ' + pageId + ': ' + err.message);
        // A row already In progress when this run started has had its note.
        var startStatus = normalizeCapsuleParty(candidate, runtime).status;
        markStillInProgress(
          runtime,
          pageId,
          err.message,
          startStatus !== runtime.status.inProgress
        );
      }
    });
  } finally {
    lock.releaseLock();
  }
}
