// Run provisionReadyOrganisations by hand, or every five minutes from a time-driven trigger.
// The function returns immediately until the Script Properties are filled in.

/**
 * Looks for Capsule organisations that need a Drive folder and provisions them.
 * Safe to run twice: an organisation that already has a linked folder is not duplicated.
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
 * Lists the organisations the next run would pick up, without touching Drive or Capsule.
 * Run this once after setup to check the trigger tags.
 */
function previewCandidates() {
  var runtime = loadRuntimeConfig();
  queryAllCandidates(runtime).forEach(function (party) {
    var org = normalizeCapsuleParty(party, runtime);
    console.log(org.name + ' (' + org.id + '): ' + org.status + (org.folderId ? ', has folder' : ''));
  });
}
