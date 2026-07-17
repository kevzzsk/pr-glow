import * as vscode from 'vscode';
import { PrHighlightController } from './controller';

export interface ExtensionTestApi {
  refresh(reason: string): Promise<void>;
  getState(): ReturnType<PrHighlightController['getStateForTests']>;
}

export function activate(context: vscode.ExtensionContext): ExtensionTestApi {
  const controller = new PrHighlightController(context);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('prGlow.refresh', () => controller.refresh('manual refresh')),
    vscode.commands.registerCommand('prGlow.signInGitHub', () => controller.commandSignInGitHub()),
    vscode.commands.registerCommand('prGlow.setBitbucketCredentials', () =>
      controller.commandSetBitbucketCredentials(),
    ),
    vscode.commands.registerCommand('prGlow.openPr', () => controller.commandOpenPr()),
  );
  void controller.refresh('activation');
  return {
    refresh: (reason) => controller.refresh(reason),
    getState: () => controller.getStateForTests(),
  };
}

export function deactivate(): void {}
