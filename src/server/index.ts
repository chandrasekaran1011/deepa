import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { addModel, removeModel, listModels, setDefaultModel } from '../store/models.js';
import { addMcpServer, removeMcpServer, listMcpServers } from '../store/mcp.js';
import chalk from 'chalk';

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deepa Configuration Interface</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .tab-btn.active { border-bottom: 2px solid #38bdf8; color: #38bdf8; }
        .modal { display: none; }
        .modal.active { display: flex; }
    </style>
</head>
<body class="min-h-screen p-8">
    <div class="max-w-4xl mx-auto">
        <header class="flex items-center justify-between mb-8">
            <h1 class="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Deepa Configuration</h1>
            <div class="text-sm text-slate-400">Agentic Assistant</div>
        </header>

        <!-- Tabs -->
        <div class="flex space-x-6 border-b border-slate-700 mb-6">
            <button id="tab-models" class="tab-btn active pb-2 px-1 text-lg font-medium hover:text-sky-400 transition-colors" onclick="switchTab('models')">Models & Providers</button>
            <button id="tab-mcp" class="tab-btn pb-2 px-1 text-lg font-medium text-slate-400 hover:text-sky-400 transition-colors" onclick="switchTab('mcp')">MCP Servers</button>
        </div>

        <!-- Models View -->
        <div id="view-models" class="space-y-6">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-slate-200">Configured Models</h2>
                <button onclick="openModal('model-modal')" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium transition-colors">+ Add Model</button>
            </div>
            <div id="models-list" class="grid gap-4">
                <!-- Populated by JS -->
            </div>
        </div>

        <!-- MCP View -->
        <div id="view-mcp" class="space-y-6 hidden">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-slate-200">Connected MCP Servers</h2>
                <button onclick="openModal('mcp-modal')" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-sm font-medium transition-colors">+ Add Server</button>
            </div>
            <div id="mcp-list" class="grid gap-4">
                <!-- Populated by JS -->
            </div>
        </div>
    </div>

    <!-- Modals Background -->
    <div id="modal-bg" class="modal fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-40 justify-center items-center">
        
        <!-- Add Model Modal -->
        <div id="model-modal" class="hidden bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-full max-w-md p-6 z-50">
            <h3 class="text-xl font-semibold mb-4 text-white">Add New Model</h3>
            <form id="form-model" onsubmit="submitModel(event)" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">Name (Alias)</label>
                    <input type="text" id="model-name" required class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="e.g. gpt4, my-local">
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">Provider</label>
                    <select id="model-provider" required class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none">
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="ollama">Ollama</option>
                        <option value="lmstudio">LM Studio</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">Model ID</label>
                    <input type="text" id="model-id" required class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="e.g. gpt-4o">
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">Base URL</label>
                    <input type="url" id="model-baseurl" required class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="https://api.openai.com/v1">
                </div>
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">API Key (Leave blank if local)</label>
                    <input type="password" id="model-apikey" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="sk-...">
                </div>
                <div class="flex items-center mt-2">
                    <input type="checkbox" id="model-default" class="mr-2">
                    <label class="text-sm text-slate-300" for="model-default">Set as default model</label>
                </div>
                <div class="flex justify-end space-x-3 mt-6">
                    <button type="button" onclick="closeModals()" class="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancel</button>
                    <button type="submit" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white font-medium transition-colors">Save Model</button>
                </div>
            </form>
        </div>

        <!-- Add MCP Modal -->
        <div id="mcp-modal" class="hidden bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-full max-w-md p-6 z-50">
            <h3 class="text-xl font-semibold mb-4 text-white">Add MCP Server</h3>
            <form id="form-mcp" onsubmit="submitMcp(event)" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-slate-400 mb-1">Server Name</label>
                    <input type="text" id="mcp-name" required class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="e.g. file-system, remote-db">
                </div>
                
                <div class="mb-4">
                    <label class="block text-sm font-medium text-slate-400 mb-2">Connection Type</label>
                    <div class="flex space-x-4">
                        <label class="flex items-center text-slate-300">
                            <input type="radio" name="mcp-type" value="stdio" checked class="mr-2" onchange="toggleMcpFields()"> Local (stdio)
                        </label>
                        <label class="flex items-center text-slate-300">
                            <input type="radio" name="mcp-type" value="http" class="mr-2" onchange="toggleMcpFields()"> Remote (HTTP/SSE)
                        </label>
                    </div>
                </div>

                <!-- Stdio Fields -->
                <div id="mcp-stdio-fields" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Command</label>
                        <input type="text" id="mcp-command" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="e.g. npx, python">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Arguments (comma separated)</label>
                        <input type="text" id="mcp-args" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="e.g. -y, @modelcontextprotocol/server-memory">
                    </div>
                </div>

                <!-- HTTP Fields -->
                <div id="mcp-http-fields" class="space-y-4 hidden">
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Server URL</label>
                        <input type="url" id="mcp-url" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none" placeholder="http://localhost:8000/sse">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-slate-400 mb-1">Transport</label>
                        <select id="mcp-transport" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white focus:border-sky-500 focus:outline-none">
                            <option value="http">Streamable HTTP</option>
                            <option value="sse">Legacy SSE</option>
                        </select>
                    </div>
                </div>

                <div class="flex justify-end space-x-3 mt-6">
                    <button type="button" onclick="closeModals()" class="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancel</button>
                    <button type="submit" class="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white font-medium transition-colors">Save Server</button>
                </div>
            </form>
        </div>

    </div>

    <script>
        // Tab switching
        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active', 'text-sky-400');
                btn.classList.add('text-slate-400');
            });
            document.getElementById(\`tab-\${tab}\`).classList.add('active', 'text-sky-400');
            document.getElementById(\`tab-\${tab}\`).classList.remove('text-slate-400');
            
            document.getElementById('view-models').classList.add('hidden');
            document.getElementById('view-mcp').classList.add('hidden');
            document.getElementById(\`view-\${tab}\`).classList.remove('hidden');
        }

        // Modal logic
        function openModal(id) {
            document.getElementById('modal-bg').classList.add('active');
            document.getElementById('model-modal').classList.add('hidden');
            document.getElementById('mcp-modal').classList.add('hidden');
            document.getElementById(id).classList.remove('hidden');
        }

        function closeModals() {
            document.getElementById('modal-bg').classList.remove('active');
            document.getElementById('form-model').reset();
            document.getElementById('form-mcp').reset();
            toggleMcpFields();
        }

        function toggleMcpFields() {
            const isHttp = document.querySelector('input[name="mcp-type"]:checked').value === 'http';
            document.getElementById('mcp-stdio-fields').classList.toggle('hidden', isHttp);
            document.getElementById('mcp-http-fields').classList.toggle('hidden', !isHttp);
            
            // Toggle required attributes
            document.getElementById('mcp-command').required = !isHttp;
            document.getElementById('mcp-url').required = isHttp;
        }

        // Provider preset handling
        document.getElementById('model-provider').addEventListener('change', (e) => {
            const presets = {
                openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o' },
                anthropic: { url: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' },
                ollama: { url: 'http://localhost:11434/v1', model: 'llama3.2' },
                lmstudio: { url: 'http://localhost:1234/v1', model: 'default' },
                custom: { url: '', model: '' }
            };
            const p = presets[e.target.value];
            if (p) {
                document.getElementById('model-baseurl').value = p.url;
                document.getElementById('model-id').value = p.model;
            }
        });

        // API Calls
        async function fetchModels() {
            const res = await fetch('/api/models');
            const data = await res.json();
            const container = document.getElementById('models-list');
            container.innerHTML = '';
            
            if (data.models.length === 0) {
                container.innerHTML = '<div class="p-6 text-center text-slate-500 bg-slate-800/50 rounded-lg border border-slate-700 border-dashed">No models configured yet.</div>';
                return;
            }

            data.models.forEach(m => {
                const badgeClass = m.isDefault ? 'bg-sky-900/50 text-sky-400 border-sky-800' : 'bg-slate-800 text-slate-400 border-slate-700';
                container.innerHTML += \`
                    <div class="flex items-center justify-between p-4 bg-slate-800/80 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
                        <div>
                            <div class="flex items-center space-x-3 mb-1">
                                <span class="font-medium text-white">\${m.name}</span>
                                <span class="px-2 py-0.5 rounded text-xs border \${badgeClass}">\${m.provider}</span>
                                \${m.isDefault ? '<span class="px-2 py-0.5 rounded text-xs border bg-green-900/30 text-green-400 border-green-800">Default</span>' : ''}
                            </div>
                            <div class="text-sm text-slate-400">
                                <span class="text-slate-300">\${m.model}</span> &middot; \${m.baseUrl}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            \${!m.isDefault ? \`<button onclick="setDefaultModel('\${m.name}')" class="p-2 text-slate-400 hover:text-sky-400 transition-colors" title="Set Default"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></button>\` : ''}
                            <button onclick="deleteModel('\${m.name}')" class="p-2 text-slate-400 hover:text-red-400 transition-colors" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                        </div>
                    </div>
                \`;
            });
        }

        async function fetchMcp() {
            const res = await fetch('/api/mcp');
            const data = await res.json();
            const container = document.getElementById('mcp-list');
            container.innerHTML = '';
            
            const entries = Object.entries(data.servers);
            if (entries.length === 0) {
                container.innerHTML = '<div class="p-6 text-center text-slate-500 bg-slate-800/50 rounded-lg border border-slate-700 border-dashed">No MCP servers connected yet.</div>';
                return;
            }

            entries.forEach(([name, config]) => {
                const isHttp = !!config.url;
                const typeLabel = isHttp ? (config.transport === 'sse' ? 'Remote (SSE)' : 'Remote (HTTP)') : 'Local (stdio)';
                const detailStr = isHttp ? \`<span class="text-sky-400">\${config.url}</span>\` : \`<span class="text-green-400">\${config.command}</span> <span class="text-slate-500">\${(config.args || []).join(' ')}</span>\`;
                
                container.innerHTML += \`
                    <div class="flex items-center justify-between p-4 bg-slate-800/80 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
                        <div>
                            <div class="flex items-center space-x-3 mb-1">
                                <span class="font-medium text-white">\${name}</span>
                                <span class="px-2 py-0.5 rounded text-xs border bg-slate-800 text-slate-400 border-slate-700">\${typeLabel}</span>
                            </div>
                            <div class="text-sm text-slate-300 font-mono mt-2 bg-slate-900 p-2 rounded">
                                \${detailStr}
                            </div>
                        </div>
                        <button onclick="deleteMcp('\${name}')" class="p-2 text-slate-400 hover:text-red-400 transition-colors" title="Delete"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                \`;
            });
        }

        async function submitModel(e) {
            e.preventDefault();
            const payload = {
                name: document.getElementById('model-name').value,
                provider: document.getElementById('model-provider').value,
                model: document.getElementById('model-id').value,
                baseUrl: document.getElementById('model-baseurl').value,
                apiKey: document.getElementById('model-apikey').value || undefined,
                maxTokens: 16384,
                isDefault: document.getElementById('model-default').checked
            };
            
            await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            closeModals();
            fetchModels();
        }

        async function submitMcp(e) {
            e.preventDefault();
            const name = document.getElementById('mcp-name').value;
            const isHttp = document.querySelector('input[name="mcp-type"]:checked').value === 'http';
            
            let payload = {};
            if (isHttp) {
                payload = {
                    url: document.getElementById('mcp-url').value,
                    transport: document.getElementById('mcp-transport').value
                };
            } else {
                const cmd = document.getElementById('mcp-command').value;
                const argsStr = document.getElementById('mcp-args').value;
                payload = {
                    command: cmd,
                    args: argsStr ? argsStr.split(',').map(s => s.trim()).filter(Boolean) : []
                };
            }

            await fetch(\`/api/mcp/\${encodeURIComponent(name)}\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            closeModals();
            fetchMcp();
        }

        async function deleteModel(name) {
            if (confirm(\`Delete model \${name}?\`)) {
                await fetch(\`/api/models/\${encodeURIComponent(name)}\`, { method: 'DELETE' });
                fetchModels();
            }
        }

        async function setDefaultModel(name) {
            await fetch(\`/api/models/\${encodeURIComponent(name)}/default\`, { method: 'POST' });
            fetchModels();
        }

        async function deleteMcp(name) {
            if (confirm(\` disconnect MCP server \${name}?\`)) {
                await fetch(\`/api/mcp/\${encodeURIComponent(name)}\`, { method: 'DELETE' });
                fetchMcp();
            }
        }

        // Init
        fetchModels();
        fetchMcp();
        
        // Close modal on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModals();
        });
    </script>
</body>
</html>`;

export function startConfigServer(port: number = 3000): Promise<void> {
    return new Promise((resolve) => {
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);

            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            // Route: GET /
            if (req.method === 'GET' && url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(UI_HTML);
                return;
            }

            // Route: GET /api/models
            if (req.method === 'GET' && url.pathname === '/api/models') {
                const models = listModels();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ models }));
                return;
            }

            // Route: POST /api/models
            if (req.method === 'POST' && url.pathname === '/api/models') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        addModel(data);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            // Route: POST /api/models/:name/default
            if (req.method === 'POST' && url.pathname.startsWith('/api/models/') && url.pathname.endsWith('/default')) {
                const parts = url.pathname.split('/');
                const name = decodeURIComponent(parts[3]);
                const ok = setDefaultModel(name);
                res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: ok }));
                return;
            }

            // Route: DELETE /api/models/:name
            if (req.method === 'DELETE' && url.pathname.startsWith('/api/models/')) {
                const name = decodeURIComponent(url.pathname.split('/')[3]);
                const ok = removeModel(name);
                res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: ok }));
                return;
            }

            // Route: GET /api/mcp
            if (req.method === 'GET' && url.pathname === '/api/mcp') {
                const servers = listMcpServers();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ servers }));
                return;
            }

            // Route: POST /api/mcp/:name
            if (req.method === 'POST' && url.pathname.startsWith('/api/mcp/')) {
                const name = decodeURIComponent(url.pathname.split('/')[3]);
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        addMcpServer(name, data);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            // Route: DELETE /api/mcp/:name
            if (req.method === 'DELETE' && url.pathname.startsWith('/api/mcp/')) {
                const name = decodeURIComponent(url.pathname.split('/')[3]);
                const ok = removeMcpServer(name);
                res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: ok }));
                return;
            }

            res.writeHead(404);
            res.end();
        });

        const tryListen = (currentPort: number) => {
            server.listen(currentPort, () => {
                console.log(chalk.green(`\n🚀 Configuration Web UI running at ${chalk.bold(`http://localhost:${currentPort}`)}\n`));
                // Optional: open the browser automatically
                resolve();
            });

            server.on('error', (e: any) => {
                if (e.code === 'EADDRINUSE') {
                    console.log(chalk.yellow(`  ⚠ Port ${currentPort} in use, trying ${currentPort + 1}...`));
                    server.close();
                    tryListen(currentPort + 1);
                } else {
                    console.error(chalk.red(`  ✗ Server error: ${e.message}`));
                    resolve();
                }
            });
        };

        tryListen(port);
    });
}
