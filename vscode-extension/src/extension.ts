import * as vscode from 'vscode';
import { DeepaPanel, captureEditorContext } from './DeepaPanel';
import { ServerManager } from './ServerManager';

let server: ServerManager | undefined;
let output: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('Deepa');
  context.subscriptions.push(output);

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(deepa-d) Deepa';
  statusBarItem.tooltip = 'Open Deepa';
  statusBarItem.command = 'deepa.openPanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Determine initial working directory
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  server = new ServerManager(cwd, output);

  // ─── Commands ───────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('deepa.openPanel', async () => {
      if (!server) return;
      const ctx = captureEditorContext();
      setStatus('loading');
      try {
        await DeepaPanel.createOrShow(server, output!, ctx);
        setStatus('ready');
      } catch (err) {
        setStatus('error');
        vscode.window.showErrorMessage(`Deepa: Failed to start — ${err}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('deepa.newSession', async () => {
      if (DeepaPanel.current) {
        DeepaPanel.current.panel?.webview.postMessage({ type: 'command', cmd: 'new_session' });
      } else {
        vscode.commands.executeCommand('deepa.openPanel');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('deepa.sendSelection', async () => {
      const ctx = captureEditorContext();
      if (!ctx?.selection) {
        vscode.window.showInformationMessage('Deepa: No text selected');
        return;
      }
      if (!server) return;
      await DeepaPanel.createOrShow(server, output!, ctx);
    }),
  );

  // Update server cwd when workspace changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (newCwd && server) server.setCwd(newCwd);
    }),
  );
}

export function deactivate() {
  server?.stop();
  output?.appendLine('[Deepa] Extension deactivated');
}

function setStatus(state: 'loading' | 'ready' | 'error') {
  if (!statusBarItem) return;
  switch (state) {
    case 'loading':
      statusBarItem.text = '$(loading~spin) Deepa';
      break;
    case 'ready':
      statusBarItem.text = '$(deepa-d) Deepa';
      break;
    case 'error':
      statusBarItem.text = '$(warning) Deepa';
      break;
  }
}
