import * as vscode from 'vscode';
import { ServerManager } from './ServerManager';

export class DeepaPanel {
  public static current: DeepaPanel | undefined;
  private static readonly viewType = 'deepaChat';

  readonly panel: vscode.WebviewPanel;
  private readonly server: ServerManager;
  private readonly output: vscode.OutputChannel;
  private serverPort: number | null = null;
  private disposables: vscode.Disposable[] = [];
  private pendingContext: EditorContext | null = null;

  // ─── Factory ──────────────────────────────────────────────────────────────

  static async createOrShow(
    server: ServerManager,
    output: vscode.OutputChannel,
    context: EditorContext | null,
  ): Promise<void> {
    const col = vscode.ViewColumn.Beside;

    if (DeepaPanel.current) {
      DeepaPanel.current.panel.reveal(col, true);
      if (context) DeepaPanel.current.injectContext(context);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DeepaPanel.viewType,
      'Deepa',
      { viewColumn: col, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    DeepaPanel.current = new DeepaPanel(panel, server, output, context);
  }

  // ─── Constructor ──────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    server: ServerManager,
    output: vscode.OutputChannel,
    initialContext: EditorContext | null,
  ) {
    this.panel = panel;
    this.server = server;
    this.output = output;
    this.pendingContext = initialContext;

    this.panel.iconPath = vscode.Uri.parse(
      `data:image/svg+xml;base64,${Buffer.from(DEEPA_D_SVG).toString('base64')}`,
    );

    // Show loading state immediately
    this.panel.webview.html = this.getLoadingHtml();

    // Start server then load real UI
    this.initServer();

    // Handle messages from webview
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this)),
    );

    // Track active editor for context injection into iframe
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.pushEditorContext()),
      vscode.window.onDidChangeTextEditorSelection(() => this.pushEditorContextDebounced()),
    );

    this.panel.onDidDispose(this.dispose.bind(this), null, this.disposables);
  }

  // ─── Server init ──────────────────────────────────────────────────────────

  private async initServer() {
    try {
      this.serverPort = await this.server.start();
      this.output.appendLine(`[Deepa Panel] Server ready on port ${this.serverPort}`);
      this.panel.webview.html = this.getWebviewHtml(this.serverPort);

      // After a short delay to let the iframe initialize, push context
      setTimeout(() => {
        if (this.pendingContext) {
          this.injectContext(this.pendingContext);
          this.pendingContext = null;
        } else {
          this.pushEditorContext();
        }
      }, 1200);
    } catch (err) {
      this.output.appendLine(`[Deepa Panel] Server start failed: ${err}`);
      this.panel.webview.html = this.getErrorHtml(String(err));
    }
  }

  // ─── Context helpers ──────────────────────────────────────────────────────

  injectContext(ctx: EditorContext) {
    // Relay editor context to the iframe via the bridge script
    this.panel.webview.postMessage({ type: 'editor_context', payload: ctx });
  }

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private pushEditorContextDebounced() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.pushEditorContext(), 300);
  }

  private pushEditorContext() {
    const ctx = captureEditorContext();
    if (ctx) this.injectContext(ctx);
  }

  // ─── Message handler ──────────────────────────────────────────────────────

  private handleMessage(msg: WebviewMessage) {
    switch (msg.type) {
      case 'ready':
        this.pushEditorContext();
        break;
      case 'open_file':
        if (msg.path) {
          vscode.workspace.openTextDocument(msg.path).then((doc) => {
            vscode.window.showTextDocument(doc, { preview: true });
          });
        }
        break;
      case 'show_diff':
        // future: native VS Code diff
        break;
      case 'copy':
        if (msg.text) vscode.env.clipboard.writeText(msg.text);
        break;
      case 'log':
        if (msg.text) this.output.appendLine(`[Deepa Webview] ${msg.text}`);
        break;
    }
  }

  // ─── Dispose ──────────────────────────────────────────────────────────────

  dispose() {
    DeepaPanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  // ─── HTML generation ──────────────────────────────────────────────────────

  private getLoadingHtml(): string {
    return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
body{background:#0f1117;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#6d9cff;}
.wrap{text-align:center;gap:16px;display:flex;flex-direction:column;align-items:center;}
.logo{font-size:48px;font-weight:900;letter-spacing:-2px;color:#6d9cff;}
.msg{color:#565a6e;font-size:13px;}
.dots{display:flex;gap:6px;}
.dot{width:7px;height:7px;background:#6d9cff;border-radius:50%;animation:b 1.2s ease-in-out infinite;}
.dot:nth-child(2){animation-delay:.2s;}
.dot:nth-child(3){animation-delay:.4s;}
@keyframes b{0%,80%,100%{opacity:.2;}40%{opacity:1;}}
</style></head><body>
<div class="wrap">
  <div class="logo">D</div>
  <div class="msg">Starting Deepa...</div>
  <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
</div>
</body></html>`;
  }

  private getErrorHtml(err: string): string {
    const escaped = err.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<!DOCTYPE html><html>
<head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;overflow:hidden;}
body{background:#0f1117;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e1e2e8;padding:24px;}
.wrap{max-width:520px;width:100%;text-align:center;}
.icon{font-size:36px;margin-bottom:12px;}
h2{font-size:20px;color:#f7768e;margin-bottom:16px;font-weight:600;}
pre{background:#1a1b26;border:1px solid #2a2d3d;border-radius:8px;padding:14px;font-size:11.5px;color:#e1e2e8;text-align:left;overflow:auto;white-space:pre-wrap;word-break:break-word;max-height:200px;margin-bottom:16px;}
.hint{color:#565a6e;font-size:12px;line-height:1.6;margin-bottom:20px;}
.hint code{background:#1a1b26;border:1px solid #2a2d3d;padding:1px 6px;border-radius:3px;color:#73daca;font-size:11px;}
.btn{background:#6d9cff;color:#0f1117;border:none;border-radius:7px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;}
.btn:hover{opacity:.88;}
</style></head><body>
<div class="wrap">
  <div class="icon">⚠</div>
  <h2>Deepa failed to start</h2>
  <pre>${escaped}</pre>
  <div class="hint">
    Make sure deepa is installed globally:<br/>
    <code>npm install -g deepa-cli</code><br/><br/>
    Or set the path in VS Code Settings:<br/>
    <code>deepa.cliPath</code> → full path to <code>dist/index.js</code><br/><br/>
    Check the <strong>Deepa</strong> output channel for details.
  </div>
  <button class="btn" onclick="location.reload()">Retry</button>
</div>
</body></html>`;
  }

  /**
   * Wraps the real deepa server UI in an iframe.
   * A tiny bridge script relays VS Code messages (editor_context) into the iframe
   * and bubbles messages from the iframe back up to the extension host.
   */
  private getWebviewHtml(port: number): string {
    const nonce = getNonce();
    const base = `http://127.0.0.1:${port}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  frame-src http://127.0.0.1:${port};
  script-src 'nonce-${nonce}';
  style-src 'nonce-${nonce}';
"/>
<title>Deepa</title>
<style nonce="${nonce}">
html, body {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  background: #0f1117;
}
iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: none;
}
</style>
</head>
<body>
<iframe id="deepa-frame" src="${base}" allow="clipboard-write"></iframe>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const frame  = document.getElementById('deepa-frame');

  // ── VS Code → iframe ───────────────────────────────────────────────
  // Forward extension-host messages (editor_context, new_session, etc.)
  // into the iframe so the deepa React app can consume them.
  window.addEventListener('message', function(e) {
    // Messages from the extension host arrive with source === window.
    // Messages from the iframe arrive with source === frame.contentWindow.
    if (e.source === frame.contentWindow) {
      // ── iframe → VS Code ──────────────────────────────────────────
      // The deepa app may post open_file / copy / log messages.
      const msg = e.data;
      if (msg && typeof msg === 'object' && msg.type) {
        switch (msg.type) {
          case 'open_file':
          case 'show_diff':
          case 'copy':
          case 'log':
            vscode.postMessage(msg);
            break;
          case 'ready':
            vscode.postMessage({ type: 'ready' });
            break;
        }
      }
    } else {
      // Message from the extension host — relay to iframe.
      // Wait until the iframe has loaded before forwarding.
      if (frame.contentWindow) {
        frame.contentWindow.postMessage(e.data, '${base}');
      }
    }
  });

  // Notify extension host that the shell is ready (iframe may take a moment).
  frame.addEventListener('load', function() {
    vscode.postMessage({ type: 'ready' });
  });
})();
</script>
</body>
</html>`;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export interface EditorContext {
  file: string;
  language: string;
  selection: string;
  selectionRange: { start: number; end: number } | null;
  workspaceRoot: string | null;
}

interface WebviewMessage {
  type: string;
  path?: string;
  text?: string;
  payload?: unknown;
}

export function captureEditorContext(): EditorContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const sel = editor.selection;
  const selection = editor.document.getText(sel);
  return {
    file: editor.document.uri.fsPath,
    language: editor.document.languageId,
    selection,
    selectionRange: selection ? { start: sel.start.line, end: sel.end.line } : null,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
  };
}

const DEEPA_D_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#1a1b26"/>
  <text x="12" y="17" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    font-size="14" font-weight="900" fill="#6d9cff" text-anchor="middle">D</text>
</svg>`;
