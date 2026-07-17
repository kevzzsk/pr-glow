import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runTests } from '@vscode/test-electron';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Open the tests against a throwaway non-git workspace so activation follows
// the "no git repository" path deterministically.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gutter-ws-'));

// Prefer a locally installed VS Code (avoids the ~150MB download; also works
// on machines where the update CDN is unreachable).
const localVsCode = [
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  path.join(os.homedir(), 'Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
].find((p) => fs.existsSync(p));

try {
  await runTests({
    ...(localVsCode ? { vscodeExecutablePath: localVsCode } : {}),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test-integration', 'suite', 'index.cjs'),
    launchArgs: [workspace, '--disable-workspace-trust', '--disable-gpu'],
  });
  console.log('activation test passed');
} catch (err) {
  console.error('activation test FAILED:', err);
  process.exit(1);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
