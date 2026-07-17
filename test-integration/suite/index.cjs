const assert = require('node:assert');
const vscode = require('vscode');

/** Entry point invoked by @vscode/test-electron inside the VS Code extension host. */
exports.run = async function run() {
  const ext = vscode.extensions.getExtension('kwol.pr-gutter-highlight');
  assert.ok(ext, 'extension kwol.pr-gutter-highlight not found in the test host');

  await ext.activate();
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

  // Refresh must resolve without throwing even in a non-git workspace.
  await vscode.commands.executeCommand('prGutterHighlight.refresh');
};
