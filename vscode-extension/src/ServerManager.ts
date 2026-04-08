import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

export class ServerManager {
  private proc: cp.ChildProcess | null = null;
  private port: number | null = null;
  private cwd: string;
  private log: vscode.OutputChannel;

  constructor(cwd: string, log: vscode.OutputChannel) {
    this.cwd = cwd;
    this.log = log;
  }

  async start(): Promise<number> {
    // Reuse if still healthy
    if (this.proc && this.port && await this.isHealthy(this.port)) {
      return this.port;
    }
    this.stop();

    // Get full interactive shell env (handles nvm, homebrew, etc.)
    const shellEnv = await getShellEnv(this.log);
    const env = { ...process.env, ...shellEnv };

    this.port = await findFreePort();

    // Resolve how to run deepa
    const { cmd, args } = await this.resolveSpawn(this.port, env.PATH);

    this.log.appendLine(`\n[Deepa] ─── Starting ───`);
    this.log.appendLine(`[Deepa] exec : ${cmd} ${args.join(' ')}`);
    this.log.appendLine(`[Deepa] cwd  : ${this.cwd}`);
    this.log.appendLine(`[Deepa] port : ${this.port}`);

    const stderrBuf: string[] = [];
    let earlyExit: number | null = null;

    this.proc = cp.spawn(cmd, args, {
      cwd: this.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout?.on('data', (d: Buffer) =>
      this.log.appendLine(`[Deepa stdout] ${d.toString().trimEnd()}`));

    this.proc.stderr?.on('data', (d: Buffer) => {
      const s = d.toString().trimEnd();
      stderrBuf.push(...s.split('\n'));
      this.log.appendLine(`[Deepa stderr] ${s}`);
    });

    this.proc.on('exit', (code) => {
      earlyExit = code ?? -1;
      this.log.appendLine(`[Deepa] process exited (code ${code})`);
      this.proc = null;
    });

    // Poll /api/status until healthy or timeout
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (earlyExit !== null) {
        const tail = stderrBuf.slice(-20).join('\n');
        throw new Error(
          `deepa process exited early (code ${earlyExit})\n\n${tail}`,
        );
      }
      if (await this.isHealthy(this.port)) {
        this.log.appendLine(`[Deepa] ✓ server ready on port ${this.port}`);
        return this.port;
      }
      await sleep(350);
    }

    const tail = stderrBuf.slice(-20).join('\n');
    throw new Error(
      `Deepa server did not respond on port ${this.port} within 25s.\n\n` +
      (tail ? `Last output:\n${tail}` : 'No output — check the Deepa output channel.'),
    );
  }

  stop() {
    this.proc?.kill('SIGTERM');
    this.proc = null;
    this.port = null;
  }

  getPort() { return this.port; }

  setCwd(newCwd: string) {
    if (newCwd !== this.cwd) {
      this.cwd = newCwd;
      this.stop();
    }
  }

  // ─── Resolve how to spawn ─────────────────────────────────────────────────

  private async resolveSpawn(
    port: number,
    envPath: string | undefined,
  ): Promise<{ cmd: string; args: string[] }> {
    const portArgs = ['ui', '--port', String(port), '--no-open'];

    // 1. Explicit setting
    const cfgPath = vscode.workspace.getConfiguration('deepa').get<string>('cliPath')?.trim();
    if (cfgPath) {
      if (fs.existsSync(cfgPath)) {
        this.log.appendLine(`[Deepa] using cliPath setting: ${cfgPath}`);
        return { cmd: process.execPath, args: [cfgPath, ...portArgs] };
      }
      this.log.appendLine(`[Deepa] WARN: deepa.cliPath not found: ${cfgPath}`);
    }

    // 2. `which deepa` with full shell PATH
    const globalBin = await which('deepa', envPath);
    if (globalBin) {
      this.log.appendLine(`[Deepa] found global binary: ${globalBin}`);
      return { cmd: globalBin, args: portArgs };
    }

    // 3. Sibling dist/ (dev: extension lives inside deepa-cli/vscode-extension/)
    const sibling = path.resolve(__dirname, '..', '..', 'dist', 'index.js');
    if (fs.existsSync(sibling)) {
      this.log.appendLine(`[Deepa] found sibling dist: ${sibling}`);
      return { cmd: process.execPath, args: [sibling, ...portArgs] };
    }

    // 4. Workspace node_modules
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (ws) {
      const local = path.join(ws, 'node_modules', '.bin', 'deepa');
      if (fs.existsSync(local)) {
        this.log.appendLine(`[Deepa] found workspace bin: ${local}`);
        return { cmd: local, args: portArgs };
      }
    }

    throw new Error(
      `Cannot find the deepa CLI.\n\n` +
      `Fix options:\n` +
      `  1. npm install -g deepa-cli\n` +
      `  2. Set VS Code setting deepa.cliPath to the full path\n` +
      `     e.g. /path/to/deepa-cli/dist/index.js`,
    );
  }

  // ─── Health check ─────────────────────────────────────────────────────────

  private isHealthy(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/api/status', timeout: 800 },
        (res) => { resolve(res.statusCode === 200); res.resume(); },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function which(bin: string, envPath?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const env = envPath ? { ...process.env, PATH: envPath } : process.env;
    const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
    cp.exec(cmd, { env, timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      resolve(stdout.trim().split('\n')[0].trim());
    });
  });
}

/**
 * Launch an interactive login shell and capture its env vars.
 * This picks up nvm, homebrew, pyenv, etc. that VS Code's process doesn't have.
 */
function getShellEnv(log: vscode.OutputChannel): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh';
    // -i interactive + -l login ensures .zshrc / .bash_profile are sourced
    cp.exec(`${shell} -i -l -c 'env'`, { timeout: 6000 }, (err, stdout) => {
      if (err || !stdout) {
        log.appendLine(`[Deepa] shell env resolution failed (${err?.message}), using VS Code env`);
        return resolve({});
      }
      const vars: Record<string, string> = {};
      for (const line of stdout.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) vars[line.slice(0, i)] = line.slice(i + 1);
      }
      log.appendLine(`[Deepa] shell PATH: ${vars.PATH?.slice(0, 120)}...`);
      resolve(vars);
    });
  });
}
