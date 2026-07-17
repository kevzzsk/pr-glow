const assert = require('node:assert');
const vscode = require('vscode');

/** Entry point invoked by @vscode/test-electron inside the VS Code extension host. */
exports.run = async function run() {
  const ext = vscode.extensions.getExtension('kwol.pr-gutter-highlight');
  assert.ok(ext, 'extension kwol.pr-gutter-highlight not found in the test host');

  const api = await ext.activate();
  assert.strictEqual(ext.isActive, true, 'extension failed to activate');

  const commands = await vscode.commands.getCommands(true);
  for (const cmd of [
    'prGutterHighlight.refresh',
    'prGutterHighlight.signInGitHub',
    'prGutterHighlight.setBitbucketCredentials',
    'prGutterHighlight.openPr',
  ]) {
    assert.ok(commands.includes(cmd), `command not registered: ${cmd}`);
  }

  const expectedNumber = process.env.PR_EXPECT_NUMBER;
  if (!expectedNumber) {
    // Non-git workspace scenario: refresh must resolve without throwing.
    await api.refresh('integration test');
    const state = api.getState();
    assert.strictEqual(state.pr, undefined, 'no PR should be detected in a non-git workspace');
    return;
  }

  // E2E scenario: the workspace is a fixture repo whose remote points at a
  // real public repo with a real open PR on the checked-out branch.
  await api.refresh('integration test e2e');
  const state = api.getState();
  assert.ok(state.pr, 'expected an open PR to be detected for the checked-out branch');
  assert.strictEqual(
    String(state.pr.number),
    expectedNumber,
    `expected PR #${expectedNumber}, got #${state.pr.number}`,
  );
  assert.strictEqual(state.pr.sourceBranch, process.env.PR_EXPECT_SOURCE_BRANCH);
  assert.ok(
    state.changedFileCount > 0,
    'expected changed files from the provider diff API fallback',
  );
};
