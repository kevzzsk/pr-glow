const assert = require('node:assert');
const vscode = require('vscode');

/** Entry point invoked by @vscode/test-electron inside the VS Code extension host. */
exports.run = async function run() {
  const ext = vscode.extensions.getExtension('kwol.pr-glow');
  assert.ok(ext, 'extension kwol.pr-glow not found in the test host');

  const api = await ext.activate();
  assert.strictEqual(ext.isActive, true, 'extension failed to activate');

  const commands = await vscode.commands.getCommands(true);
  for (const cmd of [
    'prGlow.refresh',
    'prGlow.signInGitHub',
    'prGlow.setBitbucketCredentials',
    'prGlow.openPr',
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
  if (process.env.PR_EXPECT_QUICKDIFF === '1') {
    assert.strictEqual(
      state.quickDiffReady,
      true,
      'expected quick diff to be available (local merge-base resolved)',
    );

    // Deep verification that the quick diff pipeline actually works end to
    // end in the workbench, not just that our side is wired up.
    const wsRoot = vscode.workspace.workspaceFolders[0].uri;
    const readmeUri = vscode.Uri.joinPath(wsRoot, 'README.md');

    // 1. Our provider claims the file and the base content resolves.
    const baseUri = api.getBaseUri(readmeUri);
    assert.ok(baseUri, 'expected a quick-diff base URI for README.md');
    const baseDoc = await vscode.workspace.openTextDocument(baseUri);
    assert.ok(baseDoc.getText().length > 0, 'base document resolved empty');
    const currentDoc = await vscode.workspace.openTextDocument(readmeUri);
    assert.notStrictEqual(baseDoc.getText(), currentDoc.getText(), 'base content should differ');

    // 2. The workbench computed quick-diff changes for the editor: change
    // navigation only moves the cursor if decorations exist.
    const editor = await vscode.window.showTextDocument(readmeUri, { preview: false });
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await new Promise((r) => setTimeout(r, 3000)); // let dirty-diff compute
    await vscode.commands.executeCommand('workbench.action.editor.nextChange');
    await new Promise((r) => setTimeout(r, 500));
    const line = vscode.window.activeTextEditor.selection.active.line;
    assert.ok(line > 0, `nextChange did not move the cursor (line=${line}) — quick diff decorations absent`);
    console.log(`quick diff verified: nextChange jumped to line ${line + 1}`);

    // 3. Same, but with the editor already open BEFORE a refresh (the common
    // real-world case: user has the file open, then commits). The provider
    // re-registration on refresh must make the workbench recompute.
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await api.refresh('post-open refresh');
    await new Promise((r) => setTimeout(r, 3000));
    await vscode.commands.executeCommand('workbench.action.editor.nextChange');
    await new Promise((r) => setTimeout(r, 500));
    const line2 = vscode.window.activeTextEditor.selection.active.line;
    assert.ok(line2 > 0, `nextChange after refresh did not move (line=${line2}) — stale quick diff for open editor`);
    console.log(`quick diff after refresh verified: line ${line2 + 1}`);
  }
};
