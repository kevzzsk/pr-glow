import * as vscode from 'vscode';
import { PullRequest } from './core/types';

export class PrStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.item.command = 'prGlow.openPr';
  }

  setPr(pr: PullRequest | undefined): void {
    if (!pr) {
      this.item.hide();
      return;
    }
    const providerLabel = pr.provider === 'github' ? 'GitHub' : 'Bitbucket';
    this.item.text = `$(git-pull-request) PR #${pr.number}`;
    this.item.tooltip = `${providerLabel} PR #${pr.number}: ${pr.title}\n${pr.sourceBranch} → ${pr.targetBranch}\nClick to open in browser`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
