import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

export function activate(context: vscode.ExtensionContext) {
    console.log('Deepa VS Code extension is now active!');

    // Register the chat view provider
    const provider = new DeepaChatViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DeepaChatViewProvider.viewType, provider)
    );

    // Register command to explicitly show the chat
    let disposable = vscode.commands.registerCommand('deepa.startChat', () => {
        vscode.commands.executeCommand('workbench.view.extension.deepa-sidebar');
    });

    context.subscriptions.push(disposable);
}

class DeepaChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'deepa.chatView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._setupIPC(webviewView.webview);
    }

    private _deepaProcess?: cp.ChildProcess;
    private _cachedModels: any[] | null = null;

    private _setupIPC(webview: vscode.Webview) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || process.env.USERPROFILE || __dirname;

        const cliPath = path.join(this._extensionUri.fsPath, '..', 'dist', 'index.js');
        console.log('Deepa VS Code Extension: Spawning CLI at', cliPath, 'with cwd', workspaceRoot);

        this._deepaProcess = cp.spawn('node', [cliPath, 'serve-ipc'], {
            cwd: workspaceRoot,
            env: { ...process.env }
        });

        if (this._deepaProcess.stdout) {
            const rl = readline.createInterface({
                input: this._deepaProcess.stdout,
                terminal: false
            });

            rl.on('line', (line: string) => {
                try {
                    console.log('Deepa VS Code Extension: Received IPC message:', line);
                    const data = JSON.parse(line);
                    if (data.type === 'ready') {
                        this._cachedModels = data.models || [];
                        webview.postMessage({ type: 'ready', models: this._cachedModels });
                    } else if (data.type === 'chat_started') {
                        webview.postMessage({ type: 'chat_started' });
                    } else if (data.type === 'text') {
                        webview.postMessage({ type: 'chat_response', text: data.text });
                    } else if (data.type === 'tool_call') {
                        webview.postMessage({ type: 'tool_event', text: `${data.name}` });
                    } else if (data.type === 'error') {
                        webview.postMessage({ type: 'chat_response', text: `Error: ${data.message}` });
                    }
                } catch (e) {
                    // Ignore non-JSON output
                }
            });
        }

        if (this._deepaProcess.stderr) {
            this._deepaProcess.stderr.on('data', (d) => {
                console.error(d.toString());
                webview.postMessage({ type: 'chat_response', text: `[stderr]: ${d.toString()}` });
            });
        }

        webview.onDidReceiveMessage(message => {
            if (message.type === 'webview_ready') {
                if (this._cachedModels !== null) {
                    webview.postMessage({ type: 'ready', models: this._cachedModels });
                }
            } else if (message.type === 'send_chat') {
                if (this._deepaProcess?.stdin) {
                    const payload = JSON.stringify({
                        type: 'chat',
                        text: message.text,
                        model: message.model // Include the model selected from the UI dropdown
                    });
                    this._deepaProcess.stdin.write(payload + '\n');
                }
            }
        });

        this._deepaProcess.on('exit', (code, signal) => {
            webview.postMessage({ type: 'chat_response', text: `Deepa CLI process exited (Code: ${code}, Signal: ${signal}).` });
        });

        this._deepaProcess.on('error', (err) => {
            webview.postMessage({ type: 'chat_response', text: `Failed to start Deepa CLI: ${err.message}` });
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Deepa Chat</title>
                <style>
                    body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
                </style>
            </head>
            <body>
                <div id="root" style="height: 100%;"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() { }
