import * as vscode from 'vscode';
import { FileChanges, LineRange } from './core/diff';

/** IntelliJ-style vertical stripe rendered in the gutter as an SVG data URI. */
function gutterIconUri(color: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 32" width="12" height="32"><rect x="7" y="0" width="4" height="32" rx="2" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

export class GutterDecorator implements vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType;
  private changes: FileChanges = new Map();
  private repoRoot: string | undefined;

  constructor() {
    this.decorationType = this.createDecorationType();
  }

  private createDecorationType(): vscode.TextEditorDecorationType {
    const cfg = vscode.workspace.getConfiguration('prGlow');
    const darkColor = cfg.get<string>('gutterColor.dark', '#A371F7');
    const lightColor = cfg.get<string>('gutterColor.light', '#8250DF');
    return vscode.window.createTextEditorDecorationType({
      gutterIconSize: 'cover',
      overviewRulerColor: new vscode.ThemeColor('prGlow.overviewRulerColor'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      dark: { gutterIconPath: gutterIconUri(darkColor) },
      light: { gutterIconPath: gutterIconUri(lightColor) },
    });
  }

  /** Recreate the decoration type (after a color config change) and re-apply. */
  reloadColors(): void {
    this.decorationType.dispose();
    this.decorationType = this.createDecorationType();
    this.applyToVisibleEditors();
  }

  setChanges(repoRoot: string | undefined, changes: FileChanges): void {
    this.repoRoot = repoRoot;
    this.changes = changes;
    this.applyToVisibleEditors();
  }

  clear(): void {
    this.setChanges(undefined, new Map());
  }

  applyToVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyToEditor(editor);
    }
  }

  applyToEditor(editor: vscode.TextEditor): void {
    const ranges = this.rangesForDocument(editor.document);
    editor.setDecorations(
      this.decorationType,
      ranges.map((r) => {
        const startLine = Math.max(0, r.start - 1);
        const endLine = Math.max(0, Math.min(r.end - 1, editor.document.lineCount - 1));
        return new vscode.Range(startLine, 0, endLine, 0);
      }),
    );
  }

  private rangesForDocument(doc: vscode.TextDocument): LineRange[] {
    if (!this.repoRoot || doc.uri.scheme !== 'file') {
      return [];
    }
    const rel = relativePath(this.repoRoot, doc.uri.fsPath);
    if (!rel) {
      return [];
    }
    return this.changes.get(rel) ?? [];
  }

  dispose(): void {
    this.decorationType.dispose();
  }
}

function relativePath(root: string, fsPath: string): string | undefined {
  const normRoot = root.endsWith('/') ? root : root + '/';
  if (!fsPath.startsWith(normRoot)) {
    return undefined;
  }
  return fsPath.slice(normRoot.length);
}
