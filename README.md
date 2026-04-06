# Deepa

**Universal agentic AI assistant — OpenAI, Anthropic, local LLMs, MCP, Skills, Hooks, and more.**

Deepa runs directly on your machine with full access to your filesystem, shell, and tools. It follows a **Think → Plan → Execute → Verify** loop to complete software engineering tasks autonomously.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Model Management](#model-management)
- [Agent Modes](#agent-modes)
- [Autonomy Levels](#autonomy-levels)
- [MCP Servers](#mcp-servers)
- [Skills System](#skills-system)
- [Agents System](#agents-system)
- [Sessions](#sessions)
- [Memory System](#memory-system)
- [Hooks System](#hooks-system)
- [Project Configuration](#project-configuration)
- [Web UI](#web-ui)
- [Built-in Tools](#built-in-tools)
- [Safety Features](#safety-features)
- [Token Tracking](#token-tracking)
- [Storage Layout](#storage-layout)

---

## Installation

Requires **Node.js 18+** and **npm**.

**macOS**
```bash
curl -fsSL https://raw.githubusercontent.com/chandrasekaran1011/deepa/main/scripts/install.sh | bash
```

**Windows (PowerShell as Administrator)**
```powershell
iwr -useb https://raw.githubusercontent.com/chandrasekaran1011/deepa/main/scripts/install.ps1 | iex
```

**From source**
```bash
git clone <repo>
cd deepa-cli
npm install
npm run build
npm link
```

---

## Quick Start

```bash
# Add your first model
deepa model add

# Start an interactive session
deepa

# Ask a one-shot question
deepa "explain the architecture of this project"

# Execute a task autonomously
deepa exec "refactor the auth module to use JWT and add tests"

# Generate a plan without making changes
deepa plan "add dark mode support to the settings page"

# Resume your last session
deepa --resume

# Launch the web UI
deepa ui
```

---

## CLI Reference

### Global Options

```
deepa [options] [prompt...]
```

| Flag | Description |
|---|---|
| `-p, --provider <type>` | LLM provider: `openai`, `anthropic`, `azure`, `ollama`, `lmstudio`, `custom` |
| `-m, --model <name>` | Model ID override (e.g. `gpt-4o`) |
| `-b, --base-url <url>` | API base URL override |
| `-k, --api-key <key>` | API key override (not stored) |
| `-u, --use-model <name>` | Use a named stored model from `~/.deepa/models.json` |
| `-a, --autonomy <level>` | Autonomy level: `low`, `medium`, `high` |
| `--verbose` | Enable verbose debug logging to stderr |
| `--resume` | Resume the latest session for the current directory |
| `[prompt...]` | Initial prompt — starts immediately without interactive input |

### Subcommands

| Command | Description |
|---|---|
| `deepa model add` | Add a new LLM configuration (interactive wizard) |
| `deepa model list` | List all configured models |
| `deepa model remove <name>` | Remove a model by name |
| `deepa model default <name>` | Set a model as the default |
| `deepa mcp add <name> <command> [args...]` | Add a local MCP server |
| `deepa mcp add-remote <name> <url> [transport]` | Add a remote MCP server |
| `deepa mcp remove <name>` | Remove an MCP server |
| `deepa mcp list` | List all configured MCP servers |
| `deepa plan <prompt...>` | Generate a plan without making changes |
| `deepa exec <prompt...>` | Execute a task with full tool access |
| `deepa ui [-p port]` | Launch the web UI (default port: 3001) |
| `deepa tokens [--month N] [--year N]` | Show token usage summary |
| `deepa reset` | Factory reset — delete all data in `~/.deepa` |

### Slash Commands (inside interactive session)

| Command | Description |
|---|---|
| `/help` | Show all available slash commands |
| `/mode chat\|plan\|exec` | Switch agent mode |
| `/autonomy low\|medium\|high` | Change autonomy level |
| `/model list` | List configured models |
| `/model use <name>` | Switch active model |
| `/model add` | Add a new model |
| `/mcp list` | List MCP servers |
| `/mcp add ...` | Add an MCP server |
| `/skills` | List loaded skills |
| `/agents` | List loaded agents |
| `/memory` | Show memory index |
| `/clear` | Clear conversation history |
| `/resume` | Resume latest session |
| `/compact` | Manually compress conversation history |
| `/exit` | Exit the session |

---

## Model Management

Deepa stores model configurations in `~/.deepa/models.json`. API keys are encrypted at rest using **AES-256-GCM**, keyed to the machine's hostname and username — they cannot be transferred between machines.

### Adding a Model

```bash
deepa model add
```

The interactive wizard prompts for:

1. **Name** — friendly label (e.g. `gpt5`, `claude-sonnet`, `local-llama`)
2. **Provider** — select from presets or `custom`
3. **Model ID** — exact API model string
4. **API Key** — leave blank for local models
5. **Max tokens** — context window size (default: 8000)
6. **Reasoning effort** — `off`, `low`, `medium`, `high` (for OpenAI o-series models)
7. **Thinking budget** — Anthropic extended thinking token budget (min 1024, e.g. `10000`)

### Provider Presets

| Provider | Default Base URL | Default Model |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| `anthropic` | `https://api.anthropic.com` | `claude-sonnet-4-20250514` |
| `azure` | `https://{resource}.openai.azure.com/openai/deployments/{deployment}` | `gpt-4o` |
| `ollama` | `http://localhost:11434/v1` | `llama3.2` |
| `lmstudio` | `http://localhost:1234/v1` | `default` |
| `custom` | `http://localhost:8000/v1` | `default` |

### Azure OpenAI

When using Azure, the wizard prompts for the resource name and deployment name separately, then constructs the full endpoint URL automatically. The `useMaxCompletionTokens` flag is set automatically for Azure.

### OpenAI Responses API

For newer OpenAI models (e.g. `gpt-5.4`) that require the `/v1/responses` endpoint when using `reasoning_effort` with tools, Deepa automatically routes to the Responses API. No configuration needed — it detects the requirement and switches endpoints transparently.

### Model Configuration Schema

```json
{
  "name": "my-gpt5",
  "provider": "openai",
  "model": "gpt-5.4",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "<encrypted>",
  "maxTokens": 8000,
  "reasoningEffort": "medium",
  "isDefault": true
}
```

### Commands

```bash
deepa model list              # List all models (API keys masked)
deepa model default <name>    # Set as default
deepa model remove <name>     # Remove a model
```

---

## Agent Modes

Control what Deepa does with your request.

### `chat` — Conversational

Standard Q&A mode. Deepa answers questions, explains code, and uses tools when needed but doesn't plan multi-step tasks.

```bash
deepa                         # Opens in exec mode by default
/mode chat                    # Switch to chat mode mid-session
```

### `plan` — Read-Only Planning

Deepa reads and researches the codebase, then produces a detailed implementation plan. **No files are modified.**

```bash
deepa plan "add rate limiting to the API"
/mode plan
```

### `exec` — Full Autonomous Execution (Default)

Deepa follows the full **Think → Plan → Execute → Verify** loop:

1. Calls `think` tool to reason about edge cases and approach
2. Creates a `todo` list with atomic tasks
3. Works through tasks one at a time, updating progress in real-time
4. Self-corrects on errors before marking complete

```bash
deepa exec "fix the flaky test in auth.test.ts"
/mode exec
```

---

## Autonomy Levels

Controls which tool actions require your approval before execution.

### `low` — Approve Everything

Every tool call — including reads — requires Y/N approval. Use when evaluating Deepa on an unfamiliar codebase or in sensitive environments.

```bash
deepa -a low
/autonomy low
```

### `medium` — Approve Risky Actions (Default)

File reads, searches, and writes proceed automatically. Shell commands and other high-risk operations require your approval.

```bash
deepa -a medium
```

### `high` — Fully Autonomous

Only `very-high` risk actions (e.g. irreversible system operations) require approval. Shell commands, file writes, and edits proceed automatically.

```bash
deepa -a high
```

### Denial Tracking

If you deny 3 tool requests in a row, Deepa automatically downgrades the autonomy level one step (`high → medium → low`) and logs a warning. This prevents runaway autonomy when you're actively overriding actions.

### Tool Risk Levels

| Level | Examples | medium autonomy | high autonomy |
|---|---|---|---|
| `low` | file reads, searches, think | auto | auto |
| `medium` | file writes, web fetch | auto | auto |
| `high` | shell commands, git ops | **ask** | auto |
| `very-high` | destructive operations | **ask** | **ask** |

---

## MCP Servers

[Model Context Protocol](https://modelcontextprotocol.io/) lets you connect Deepa to any external tool, database, or API through a standardized interface.

### Adding a Local MCP Server (stdio)

```bash
deepa mcp add <name> <command> [args...]

# Examples:
deepa mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /Users/you/projects
deepa mcp add postgres npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb
deepa mcp add github npx -y @modelcontextprotocol/server-github
```

### Adding a Remote MCP Server (SSE or HTTP)

```bash
deepa mcp add-remote <name> <url> [transport]

# Examples:
deepa mcp add-remote jira https://internal-mcp.company.com/sse sse
deepa mcp add-remote analytics https://mcp.company.com/stream http
```

Transport defaults to `http` if not specified.

### Managing Servers

```bash
deepa mcp list                # List all configured servers
deepa mcp remove <name>       # Remove a server
/mcp list                     # List inside interactive session
```

### How MCP Tools Work

When Deepa starts, it connects to all configured MCP servers and discovers their tools. Each tool is registered as `mcp_{serverName}_{toolName}`.

For example, a `filesystem` server with a `read_file` tool becomes `mcp_filesystem_read_file`. Deepa uses these tools exactly like its built-in tools.

### Project-Level MCP Servers

Add MCP servers for a specific project in `.deepa.json`:

```json
{
  "mcpServers": {
    "local-db": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "./data.db"]
    }
  }
}
```

Project servers are merged with global servers — project-level servers take precedence on name conflicts.

---

## Skills System

Skills teach Deepa your organization's internal workflows, coding standards, and proprietary APIs. They use **progressive disclosure** — descriptions are always loaded, but full instructions are only read from disk when the skill is relevant to the current task.

### Directory Locations

Skills are loaded from these directories (project skills override global on name conflict):

| Priority | Path | Scope |
|---|---|---|
| 1 (lowest) | `~/.deepa/skills/` | Global — all projects |
| 2 | `~/.agents/skills/` | Legacy global location |
| 3 | `.deepa/skills/` | Project-specific |
| 4 (highest) | `.agents/skills/` | Legacy project location |

### Creating a Skill

```
.deepa/skills/
  react-components/
    SKILL.md
    PATTERNS.md       ← optional reference files
    examples/
      Button.tsx
```

**SKILL.md** — required file, YAML frontmatter + instructions:

```markdown
---
name: react-components
description: Use when building React components, UI forms, or styling frontend code. Covers our internal design system and component library conventions.
allowed-tools: file_read, file_write, file_edit, search_grep
---

# React Component Guidelines

Always use our internal `@acme/ui` library. Never use raw HTML elements.

## Imports
```tsx
import { Button, Input, Card } from '@acme/ui';
```

## File Structure
Components go in `src/components/{ComponentName}/index.tsx`.
Each component must have a co-located `*.test.tsx` file.

@PATTERNS.md
```

### Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Lowercase letters, numbers, hyphens only. Max 64 chars. |
| `description` | Yes | What the skill does — shown to model for relevance matching. Max 1024 chars. |
| `allowed-tools` | No | Comma-separated list of tools this skill permits. Restricts the agent when skill is active. |

### Content Directives

Inside SKILL.md body:
- `` @path/to/file `` — Import another file from the skill directory. Resolved relative to the skill dir.
- `` !`command` `` — Execute a shell command and inline its output (e.g. for dynamic API docs).

### How Skills Are Used

When Deepa starts, it loads skill descriptions (not bodies) into the system prompt. The model sees:

```
Available Skills:
- react-components: Use when building React components, UI forms, or styling frontend code...
```

When a skill is relevant, the model calls `use_skill(name: "react-components")` to load the full instructions. This keeps the context window lean for unrelated tasks.

```bash
/skills                        # List all loaded skills
```

---

## Agents System

Agents are specialized subagents with custom system prompts, model choices, and tool restrictions. They run in **complete isolation** from the parent conversation.

### Directory Locations

| Priority | Path | Scope |
|---|---|---|
| 1 (lowest) | `~/.deepa/agents/` | Global |
| 2 (highest) | `.deepa/agents/` | Project |

### Creating an Agent

Supported formats:
- `.deepa/agents/code-reviewer.md` — single file
- `.deepa/agents/code-reviewer/AGENT.md` — directory-based

**AGENT.md** — frontmatter + system prompt:

```markdown
---
name: code-reviewer
description: Expert code reviewer. Use for reviewing PRs, auditing security, and checking code quality.
model: inherit
tools: read-only
max-turns: 20
---

You are a senior engineer reviewing code. Focus on:
- Security vulnerabilities (OWASP Top 10)
- Performance issues
- Code clarity and maintainability

Be specific — cite file paths and line numbers. Be concise.
```

### Frontmatter Fields

| Field | Default | Description |
|---|---|---|
| `name` | filename | Agent identifier |
| `description` | required | When to use this agent (shown in system prompt) |
| `model` | `inherit` | `inherit` to use the parent's model, or a stored model name |
| `tools` | all | Tool category or comma-separated tool names |
| `max-turns` | `30` | Maximum agent loop iterations |

### Tool Categories

| Category | Tools Included |
|---|---|
| `read-only` | `file_read`, `file_list`, `search_grep`, `search_files` |
| `write` | `file_write`, `file_edit` |
| `shell` | `shell` |
| `web` | `web_fetch`, `web_search` |
| `all` | All tools (no restriction) |

Mix categories with explicit tools: `tools: read-only, shell, mcp_jira_create_ticket`

### Spawning Agents

Deepa spawns agents via the `spawn_agent` tool (called by the model):

```
spawn_agent(agent: "code-reviewer", task: "Review src/auth/ for security issues. Focus on token validation.")
```

Agents are limited to **depth 5** — nested spawning beyond this is blocked to prevent runaway recursion.

```bash
/agents                        # List all loaded agents
```

---

## Sessions

Every conversation is automatically saved. Sessions are stored per-project and can be resumed.

### Storage Format

Sessions use **JSONL format** (one JSON record per line):

```
~/.deepa/sessions/{sanitized-project-path}/{uuid}.jsonl
```

**Line 1 — Header:**
```json
{"type":"header","id":"550e8400-e29b-41d4-a716-446655440000","cwd":"/Users/you/projects/myapp","title":"Refactor the auth module","createdAt":"2025-04-06T10:00:00.000Z","version":1}
```

**Lines 2+ — Messages:**
```json
{"type":"message","message":{"role":"user","content":"..."},"ts":"2025-04-06T10:00:01.000Z"}
{"type":"message","message":{"role":"assistant","content":"..."},"ts":"2025-04-06T10:00:03.000Z"}
```

### Key Properties

- **UUID IDs** — globally unique, not time-dependent
- **Project-scoped** — sessions for `/projects/myapp` are separate from `/projects/other`
- **Owner-only permissions** — files written with mode `0o600`; sessions can contain secrets
- **Incremental writes** — each message is appended as it arrives, not a full rewrite
- **Auto-title** — session title extracted from your first message (max 80 chars)
- **Graceful shutdown** — sessions are flushed on `SIGINT`, `SIGTERM`, and process `exit`

### Resuming Sessions

```bash
deepa --resume                 # Resume latest session for current directory
```

### Session Management in Web UI

The web UI shows a list of recent sessions in the sidebar. Click any session to load it. Use the "+" button to start a new session.

---

## Memory System

Deepa's memory system stores knowledge across sessions. It is **file-based** — you can read, edit, and delete memory files directly.

### Directory Structure

```
~/.deepa/memory/
  global/
    MEMORY.md          ← index (loaded in every session)
    feedback_style.md
    user_role.md
  projects/
    myapp_a1b2c3d4/    ← keyed by project path hash
      MEMORY.md        ← index (loaded for this project)
      architecture.md
      api_conventions.md
  agents/
    code-reviewer/
      MEMORY.md
```

### Memory Types

| Type | When to save | Example |
|---|---|---|
| `user` | User role, preferences, expertise | "Prefers TypeScript. Senior backend engineer." |
| `feedback` | Corrections and confirmed approaches | "Don't use mocks in tests — real DB only. Reason: prior incident." |
| `project` | Decisions, goals, deadlines not in code | "Auth rewrite driven by compliance requirement, not tech debt." |
| `reference` | Pointers to external resources | "Pipeline bugs tracked in Linear project INGEST." |

### Memory File Format

Each memory is a separate `.md` file with optional YAML frontmatter:

```markdown
---
name: testing-approach
description: How tests are written in this project — no mocks, real database
type: feedback
---

Always use a real database in tests, never mocks.

**Why:** A prior incident where mocked tests passed but the prod migration failed.

**How to apply:** Any time writing tests that touch data storage.
```

### MEMORY.md Index

Each memory directory has a `MEMORY.md` that acts as an index. Keep entries under 150 chars each:

```markdown
- [Testing approach](testing_approach.md) — no mocks, always real DB
- [API conventions](api_conventions.md) — REST style, snake_case params
- [User role](user_role.md) — senior backend engineer, new to React
```

The index is loaded into every session automatically. Individual files are referenced but not loaded unless explicitly read.

### Staleness Indicators

Memory files show age warnings in the index when the system prompt is built:

| Age | Warning |
|---|---|
| < 1 day | No warning |
| 1–7 days | `(3d old — verify before acting)` |
| 7–30 days | `(2w old — claims may be outdated)` |
| 30+ days | `(2mo old — likely stale)` |

### What NOT to Save in Memory

Deepa will avoid saving things already knowable from the code:
- Code patterns, file structure, architecture (read the code)
- Git history, who changed what (use `git log`)
- Debugging steps or fix recipes (the fix is in the code)
- Anything already in `AGENTS.md` or `.deepa.json`

### Viewing Memory

```bash
/memory                        # Show memory index in session
```

---

## Hooks System

Hooks let you run shell commands at key points in the agent loop — for audit logging, policy enforcement, or injecting dynamic context.

### Configuration Files

Hooks are configured in JSON files. Both files are merged — global hooks run first, then project hooks.

| File | Scope |
|---|---|
| `~/.deepa/settings.json` | Global — all projects |
| `.deepa/settings.json` | Project-specific |

### Configuration Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "echo 'Tool: $DEEPA_TOOL_NAME being called' >> ~/deepa-audit.log",
        "timeout": 3000
      }
    ],
    "PostToolUse": [
      {
        "command": "./scripts/validate-output.sh",
        "cwd": "/path/to/project",
        "timeout": 5000
      }
    ],
    "SessionStart": [
      {
        "command": "cat .deepa/context.txt"
      }
    ],
    "SessionEnd": []
  }
}
```

### Hook Events

| Event | When it fires | Can block? |
|---|---|---|
| `SessionStart` | Once when the agent loop begins | No |
| `PreToolUse` | Before every tool execution | **Yes** |
| `PostToolUse` | After every tool execution | No (can augment) |
| `SessionEnd` | When the session ends | No |

### Exit Code Semantics

| Exit code | Behavior |
|---|---|
| `0` + stdout | Stdout is injected as context into the model's next turn |
| `2` + stderr | **Blocks the tool call.** Stderr is shown as an error message to the model. |
| Any other | Non-fatal — hook output is ignored |

### Environment Variables

Every hook receives these environment variables:

| Variable | Value |
|---|---|
| `DEEPA_TOOL_NAME` | Tool being executed (e.g. `shell`, `file_write`) |
| `DEEPA_TOOL_INPUT` | Tool parameters as JSON string |
| `DEEPA_TOOL_RESULT` | Tool result as JSON string (first 500 chars) |
| `DEEPA_SESSION_ID` | Current session UUID |
| `DEEPA_CWD` | Working directory |

### Hook Definition Fields

| Field | Default | Description |
|---|---|---|
| `command` | required | Shell command to run |
| `cwd` | project dir | Working directory for the command |
| `timeout` | `5000` | Timeout in milliseconds |

### Example: Block Writes to Production Config

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "if [[ \"$DEEPA_TOOL_NAME\" == 'file_write' ]]; then INPUT=$(echo $DEEPA_TOOL_INPUT | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get('path',''))\"); if [[ \"$INPUT\" == *'production'* ]]; then echo 'Blocked: writes to production configs require manual deployment' >&2; exit 2; fi; fi"
      }
    ]
  }
}
```

### Example: Inject Dynamic Context at Session Start

```json
{
  "hooks": {
    "SessionStart": [
      {
        "command": "echo \"Current git branch: $(git branch --show-current). Open PRs: $(gh pr list --limit 3 --json title -q '.[].title' 2>/dev/null | tr '\n' ', ')\""
      }
    ]
  }
}
```

---

## Project Configuration

### `.deepa.json`

Place in your project root to configure Deepa for that project. All fields are optional.

```json
{
  "provider": {
    "type": "openai",
    "model": "gpt-4o",
    "baseUrl": "https://api.openai.com/v1",
    "maxTokens": 8000
  },
  "autonomy": "medium",
  "mode": "exec",
  "verbose": false,
  "mcpServers": {
    "local-db": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "./dev.db"]
    },
    "company-jira": {
      "url": "https://internal-mcp.company.com/sse",
      "transport": "sse"
    }
  }
}
```

**Configuration priority (highest wins):**
1. CLI flags (`-m`, `-a`, `-p`, etc.)
2. `.deepa.json` in project root
3. Default stored model (`~/.deepa/models.json`)
4. Built-in defaults (openai/gpt-4o, medium, exec)

### `AGENTS.md` / `AGENT.md` / `CLAUDE.md`

Deepa loads a project context file and injects it into the system prompt. Files are checked in this order — first found wins:

1. `AGENT.local.md`
2. `AGENT.md`
3. `DEEPA.local.md`
4. `DEEPA.md`
5. `CLAUDE.md`
6. `AGENTS.md`
7. `.agents.md`

Use this file to describe your project's architecture, conventions, and guidelines:

```markdown
# My Project

## Architecture
This is a Node.js monorepo. API lives in `packages/api/`, frontend in `packages/web/`.

## Conventions
- All API routes use Zod for validation
- Tests use Vitest, not Jest
- Never commit `.env` files — use `.env.example` as template

## Important Files
- `packages/api/src/routes/` — all HTTP routes
- `packages/api/src/middleware/auth.ts` — authentication logic
```

### `.deepa/rules/`

Additional rule files in `.md` or `.txt` format loaded from `.deepa/rules/` and `.agent/rules/`. Each file is injected as a separate "Rule" section in the system prompt.

```
.deepa/rules/
  security.md         ← Security guidelines
  code-style.md       ← Formatting and naming conventions
  testing.md          ← Test requirements
```

---

## Web UI

```bash
deepa ui                    # Starts on http://localhost:3001
deepa ui -p 8080            # Custom port
```

The web UI provides a full chat interface with:
- Real-time streaming responses
- Tool call visibility (expand to see inputs/outputs)
- Session history sidebar
- Settings panel (models, MCP, mode, autonomy, reasoning)
- Dark/light/auto theme toggle
- Image upload support (paste from clipboard or attach files)

### API Endpoints

The web server also exposes a REST API if you want to integrate with other tools:

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | Current model, mode, autonomy, reasoning |
| `/api/chat/history` | GET | Current session messages |
| `/api/chat` | POST | Send a message (multipart/form-data with `message` + optional `files[]`) |
| `/api/chat/stop` | POST | Abort in-flight response |
| `/api/chat/confirm` | POST | Respond to a tool confirmation request `{ response: 'allow'|'deny' }` |
| `/api/models` | GET | List all models |
| `/api/models` | POST | Add a model |
| `/api/models/:name` | DELETE | Remove a model |
| `/api/models/:name/default` | POST | Set as default |
| `/api/mcp` | GET | List MCP servers |
| `/api/mcp/:name` | POST | Add MCP server |
| `/api/mcp/:name` | DELETE | Remove MCP server |
| `/api/skills` | GET | List loaded skills |
| `/api/sessions` | GET | List sessions for current project |
| `/api/sessions/new` | POST | Create new session |
| `/api/sessions/:id/load` | POST | Load a session |
| `/api/sessions/:id` | DELETE | Delete a session |
| `/api/settings` | POST | Update runtime settings `{ model?, autonomy?, mode?, reasoning? }` |
| `/api/provider-presets` | GET | List provider presets |

---

## Built-in Tools

### File Tools

| Tool | Risk | Description |
|---|---|---|
| `file_read` | low | Read file contents. Optional `startLine`/`endLine` for ranges. Max 500 lines per call. |
| `file_write` | high | Write or append to a file. Creates parent directories automatically. |
| `file_edit` | high | Replace a line range in an existing file. |
| `file_list` | low | List directory contents. Supports glob patterns. Respects `.gitignore`. |

### Search Tools

| Tool | Risk | Description |
|---|---|---|
| `search_grep` | low | Search file contents by regex. Returns matching lines with context. |
| `search_files` | low | Find files by name pattern. Supports type filter (`file`/`directory`). |

### Shell Tool

| Tool | Risk | Description |
|---|---|---|
| `shell` | high | Execute shell commands. Supports `timeout`, `cwd`, and `background` for servers. |

The shell tool automatically converts inline scripts to temp files for reliable execution:

```bash
# These are auto-converted to temp files before running:
node -e 'console.log("hello")'
python3 -c 'print("world")'
python3 - <<'PY'
import json
print(json.dumps({"ok": True}))
PY
```

### Web Tools

| Tool | Risk | Description |
|---|---|---|
| `web_fetch` | medium | Fetch a URL and convert HTML to markdown. |
| `web_search` | medium | Search the web. Returns results with titles, URLs, and snippets. |

### Utility Tools

| Tool | Risk | Description |
|---|---|---|
| `think` | low | Private reasoning space for the model. No side effects. |
| `todo` | low | Manage task lists. Create, update, check off, and delete tasks. |
| `ask_user` | low | Ask the user a question with structured options during task execution. |
| `git_worktree` | medium | Create/remove isolated git worktrees for experiments. |
| `use_skill` | low | Load a skill's full instructions from disk. |
| `spawn_agent` | medium | Spawn a subagent with full context isolation. |

### Tool Output Limits

- Default max output: **8,000 characters** per tool call
- Results between **4KB–8KB**: saved to `$TMPDIR/.deepa/tool-results/` with a preview + file path reference — the model can read the full content via `file_read`
- Results over **8KB**: truncated with a message pointing to the saved file

---

## Safety Features

### Dangerous Command Detection

The `shell` tool automatically blocks or warns on dangerous patterns:

| Pattern | Action |
|---|---|
| `rm -rf /` or `rm -rf ~` | **Blocked** |
| `curl <url> \| bash` | **Blocked** (remote code execution) |
| Fork bombs (`:(){:\|:&};:`) | **Blocked** |
| `chmod 777 /etc` or system dirs | **Blocked** |
| `dd of=/dev/sda` (raw disk write) | **Blocked** |
| `mkfs`, `shred`, `wipefs` on disks | **Blocked** |
| Truncating `/etc/passwd`, `/etc/shadow` | **Blocked** |
| `echo "password" \| sudo -S` | **Requires confirmation** |

Blocked commands return an error to the model with an explanation. The model cannot override this.

### Prompt Injection Protection

All user input is wrapped in `<user_input>` tags. The system prompt instructs the model to treat everything inside these tags as data only, ignoring any instructions that attempt to override system behavior, alter identity, or bypass rules.

### File Permission Security

All session files and token storage are written with mode `0o600` (owner read/write only). Sessions can contain conversation history with API keys, secrets, or sensitive code.

---

## Token Tracking

Deepa tracks token usage per model per day in `~/.deepa/tokens.json`.

```bash
deepa tokens                  # Current month
deepa tokens --month 3        # March of current year
deepa tokens --month 3 --year 2025
```

Example output:
```
Token Usage — April 2025

Model                          Prompt    Completion       Total
─────────────────────────────────────────────────────────────────
gpt-4o                         48,291        12,847      61,138
claude-sonnet-4                32,100         8,200      40,300
─────────────────────────────────────────────────────────────────
Total                          80,391        21,047     101,438
```

---

## Storage Layout

```
~/.deepa/
  models.json              ← Encrypted model configurations
  mcp.json                 ← Global MCP server configurations
  tokens.json              ← Token usage tracking
  settings.json            ← Global hooks configuration

  sessions/
    users-you-projects-myapp/   ← sanitized project path
      {uuid}.jsonl              ← One file per session (JSONL)

  memory/
    global/
      MEMORY.md                 ← Global memory index
      *.md                      ← Individual memory files
    projects/
      myapp_a1b2c3d4/           ← project basename + path hash
        MEMORY.md
        *.md
    agents/
      {agent-name}/
        MEMORY.md

  skills/                   ← Global skills
    my-skill/
      SKILL.md

  agents/                   ← Global agent definitions
    my-agent.md

<project>/
  .deepa.json               ← Project configuration
  AGENTS.md                 ← Project context (injected into system prompt)

  .deepa/
    settings.json           ← Project hooks configuration
    skills/                 ← Project-specific skills
      my-skill/
        SKILL.md
    agents/                 ← Project-specific agents
      my-agent.md
    rules/                  ← Additional rule files (*.md, *.txt)
      security.md
      conventions.md
```

---

*For issues and feedback: open a GitHub issue or contact the maintainers.*
