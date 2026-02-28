# Deepa CLI

**Universal agentic CLI coding agent — supports OpenAI, Anthropic, local LLMs, MCP, plugins, and skills.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

Deepa is a powerful agentic assistant that runs directly on your machine. It helps developers write, debug, refactor, and understand code — and handles a wide range of tasks beyond just coding. It has full access to your local filesystem, shell, and development tools.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Agent Modes](#agent-modes)
- [Autonomy Levels](#autonomy-levels)
- [Slash Commands](#slash-commands)
- [Built-in Tools](#built-in-tools)
- [LLM Providers](#llm-providers)
- [Model Management](#model-management)
- [MCP Server Integration](#mcp-server-integration)
- [Skills System](#skills-system)
- [Sessions & Memory](#sessions--memory)
- [Image Support](#image-support)
- [Web UI](#web-ui)
- [Project Context (AGENTS.md)](#project-context-agentsmd)
- [Development](#development)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- **Multi-provider LLM support** — OpenAI, Anthropic, Ollama, LM Studio, or any OpenAI-compatible endpoint
- **14 built-in tools** — file operations, search, web fetch, shell execution, git worktrees, task tracking, skills
- **3 agent modes** — chat (conversational), plan (read-only planning), exec (autonomous execution)
- **3 autonomy levels** — low (approve everything), medium (auto-approve safe actions), high (auto-approve most actions)
- **MCP server integration** — connect to local or remote MCP servers via stdio, SSE, or HTTP transports
- **Skill system** — progressive disclosure skill loading following Claude's official Agent Skills pattern
- **Session persistence** — conversations auto-saved and resumable with `--resume`
- **Persistent memory** — global and project-scoped memory across sessions
- **Image/vision support** — analyze images via file path or clipboard paste
- **Web UI** — browser-based chat interface and configuration panel
- **Encrypted credential storage** — API keys encrypted at rest with AES-256-GCM
- **Streaming markdown** — real-time rendered markdown output in terminal
- **DuckDuckGo web search** — built-in web search with no API key required
- **Git worktrees** — create isolated workspaces for parallel development

---

## Installation

### Prerequisites

- Node.js 18 or later
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/your-org/deepa-cli.git
cd deepa-cli

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional — makes `deepa` available everywhere)
npm link
```

### First-time Model Setup

Before using Deepa, add at least one LLM provider:

```bash
deepa

# Inside the REPL:
/model add
```

You'll be prompted for:
- **Name** — a friendly label (e.g., `gpt4`, `claude`, `local-llama`)
- **Provider** — `openai`, `anthropic`, `ollama`, `lmstudio`, or `custom`
- **Model** — model identifier (e.g., `gpt-4o`, `claude-sonnet-4-20250514`)
- **API Key** — encrypted and stored in `~/.deepa/models.json`

---

## Quick Start

```bash
# Start interactive REPL (default: exec mode)
deepa

# Start with a prompt
deepa "explain this codebase"

# Start in plan mode
deepa plan "refactor the auth module"

# Start in exec mode with high autonomy
deepa exec -a high "add unit tests for the API routes"

# Resume the latest session
deepa --resume

# Use a specific stored model
deepa -u claude "review this PR"

# Use a provider directly (without stored model)
deepa -p anthropic -m claude-sonnet-4-20250514 -k sk-ant-...

# Launch the web UI (chat + settings)
deepa ui
```

---

## Configuration

### CLI Flags

| Flag | Description |
|------|-------------|
| `-p, --provider <type>` | LLM provider: `openai`, `anthropic`, `ollama`, `lmstudio`, `custom` |
| `-m, --model <name>` | Model name/ID (e.g., `gpt-4o`) |
| `-b, --base-url <url>` | API base URL |
| `-k, --api-key <key>` | API key |
| `-u, --use-model <name>` | Use a named stored model |
| `-a, --autonomy <level>` | Autonomy level: `low`, `medium`, `high` |
| `--verbose` | Enable verbose/debug logging |
| `--resume` | Resume the latest session |

### Subcommands

| Command | Description |
|---------|-------------|
| `deepa` | Start interactive REPL (default: exec mode) |
| `deepa plan [prompt]` | Start in plan mode |
| `deepa exec [prompt]` | Start in exec mode |
| `deepa ui [--port]` | Launch web chat UI (default port: 3001) |
| `deepa model add\|list\|remove\|default` | Model management |
| `deepa mcp add\|add-remote\|list\|remove` | MCP server management |

### Project Config (`.deepa.json`)

Place a `.deepa.json` file in your project root to set project-specific defaults:

```json
{
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "baseUrl": "https://api.anthropic.com",
    "maxTokens": 16384
  },
  "autonomy": "medium",
  "mode": "exec",
  "verbose": false,
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["./mcp-server.js"]
    }
  }
}
```

### Configuration Priority

Settings are loaded in this order (later overrides earlier):

1. **Built-in defaults** — `openai`, `gpt-4o`, `medium` autonomy, `exec` mode
2. **Stored model** — from `~/.deepa/models.json` (encrypted)
3. **Project config** — from `.deepa.json` in project root
4. **CLI flags** — highest priority

### Global Storage

Deepa stores all data under `~/.deepa/`:

```
~/.deepa/
├── models.json          # Encrypted model configurations
├── mcp.json             # MCP server configurations
├── input-history.json   # Command input history (max 500 entries)
├── sessions/            # Saved conversation sessions
├── memory/
│   ├── global/          # Global memory (shared across projects)
│   └── projects/        # Per-project memory ({name}_{hash}/)
├── skills/              # Installed skills
└── plugins/             # Plugins
```

---

## Agent Modes

Deepa operates in three modes, switchable at any time during a session:

### Chat Mode (`/chat`)

Interactive conversational mode. The agent helps with questions, uses tools when needed, and keeps responses concise. Best for quick questions and light tasks.

### Plan Mode (`/plan`)

Read-only planning mode. The agent researches the codebase and creates detailed implementation plans using the todo tool — but makes **no file changes**. Use this to understand a task before committing to changes.

**Generated plans include:**
- Problem analysis
- Proposed file changes (new, modified, deleted)
- Implementation steps as a checkbox list
- Testing/verification approach

### Exec Mode (`/exec`) — Default

Autonomous execution mode. The agent follows a **Plan → Execute → Verify** workflow:

1. **Plan** — checks for matching skills, then creates an atomic todo list before any work
2. **Execute** — works through tasks one at a time, dynamically updating the list (splitting, adding, removing tasks as needed)
3. **Verify** — validates each step before marking complete; never marks a task done if errors remain

Switch modes inside the REPL:

```
/plan     # Switch to plan mode
/exec     # Switch to exec mode
/chat     # Switch to chat mode
```

---

## Autonomy Levels

Autonomy controls which tool actions require your approval before execution:

| Level | Auto-approved | Requires Approval |
|-------|--------------|-------------------|
| **low** | Nothing | All tool actions |
| **medium** | Low & medium risk (file reads, searches, web fetch, file writes, edits) | High risk (shell commands) |
| **high** | Low, medium & high risk | Only very-high risk actions |

Set autonomy via CLI flag or inside the REPL:

```bash
# Via CLI
deepa -a high "run the test suite and fix failures"

# Inside REPL
/autonomy high
/autonomy         # View current level
```

### Tool Risk Levels

| Risk | Tools | What it covers |
|------|-------|----------------|
| **low** | `file_read`, `file_list`, `search_grep`, `search_files`, `web_search`, `web_fetch`, `todo`, `use_skill` | Read-only operations |
| **medium** | `file_write`, `file_edit`, `git_worktree`, MCP tools | File modifications, external tools |
| **high** | `shell` | Arbitrary command execution |

When an action requires approval, you'll see a confirmation prompt with three options:
- **Allow** — execute the action
- **Deny** — skip the action
- **Edit** — modify the command before executing

---

## Slash Commands

All commands available inside the Deepa REPL:

### Navigation & Control

| Command | Description |
|---------|-------------|
| `/help`, `/h` | Show available commands |
| `/quit`, `/exit`, `/q` | Exit Deepa |
| `/clear` | Clear conversation history |
| `/compact` | Compact conversation history (keep last 4 messages) |
| `/session` | Display current session info |

### Mode & Autonomy

| Command | Description |
|---------|-------------|
| `/plan` | Switch to plan mode |
| `/exec` | Switch to exec mode |
| `/chat` | Switch to chat mode |
| `/autonomy [level]` | View or set autonomy level (`low`, `medium`, `high`) |

### Model Management

| Command | Description |
|---------|-------------|
| `/model add` | Add a new model configuration (interactive) |
| `/model list` | List configured models |
| `/model remove <name>` | Remove a model |
| `/model default <name>` | Set a model as default |
| `/model use <name>` | Switch to a model for this session |

### MCP Servers

| Command | Description |
|---------|-------------|
| `/mcp add <name> <cmd> [args]` | Add a local MCP server (stdio) |
| `/mcp add-remote <name> <url> [transport]` | Add a remote MCP server (`sse` or `http`) |
| `/mcp remove <name>` | Remove an MCP server |
| `/mcp list` | List configured MCP servers |

### Skills & Media

| Command | Description |
|---------|-------------|
| `/skills` | List available skills with descriptions |
| `/memory` | View memory entries |
| `/image <path> [message]` | Attach and analyze an image |
| `/paste [message]` | Paste image from clipboard (macOS only) |

---

## Built-in Tools

Deepa provides 12 built-in tools. MCP servers can add additional tools dynamically.

### File Operations

| Tool | Risk | Description |
|------|------|-------------|
| `file_read` | low | Read file contents with optional line ranges. Max 500 lines per read, 256KB file size limit |
| `file_write` | medium | Write or append text content to files. Supports `append` mode for large files and `createDirectories`. Blocks binary formats (`.pptx`, `.xlsx`, `.pdf`, `.docx`, images, archives) |
| `file_edit` | medium | Search-and-replace file editing with 3-line surrounding context. Supports `replaceAll` for bulk replacements |
| `file_list` | low | Directory listing as tree structure (default depth: 2). Auto-ignores `node_modules`, `.git`, `__pycache__`, `.next`, `dist`, `.DS_Store`, `.venv`, `coverage`, `.cache`, `.turbo` |

### Search

| Tool | Risk | Description |
|------|------|-------------|
| `search_grep` | low | Pattern search across files using ripgrep or grep. Supports regex, case-insensitive search, and glob file filters. Default max: 50 results |
| `search_files` | low | Find files by name or glob pattern using fd or find. Case-insensitive by default. Supports file/directory type filtering |

### Web

| Tool | Risk | Description |
|------|------|-------------|
| `web_search` | low | Search using DuckDuckGo API — no API key required. Default max: 8 results |
| `web_fetch` | low | Fetch a URL and convert HTML to markdown. Also handles JSON and plain text responses. Default max: 8000 characters |

### Execution

| Tool | Risk | Description |
|------|------|-------------|
| `shell` | high | Execute shell commands with subprocess management. Supports background processes (`background: true`), custom timeouts (default: 30s), and custom working directory. Auto-converts inline scripts (`node -e`, `python -c`) to temp files for reliability. Max output: 8000 characters |

### Development

| Tool | Risk | Description |
|------|------|-------------|
| `git_worktree` | medium | Create, list, and remove Git worktrees for isolated workspaces. Actions: `create` (new branch + worktree), `list` (active worktrees), `remove` (by path) |
| `todo` | low | Agentic task tracking with progress bar. Full-list replacement model — send the complete list each call. Each item has `content`, `status` (pending/in_progress/completed), and `activeForm` (present-tense label for UI display) |

### Skills

| Tool | Risk | Description |
|------|------|-------------|
| `use_skill` | low | Read skill instructions on demand (progressive disclosure). Call with `name` to read SKILL.md, or with `name` + `file` to read referenced files within the skill directory |

---

## LLM Providers

Deepa supports 5 provider types:

| Provider | Base URL | API Key | Default Model |
|----------|----------|:-------:|---------------|
| **openai** | `https://api.openai.com/v1` | Required | `gpt-4o` |
| **anthropic** | `https://api.anthropic.com` | Required | `claude-sonnet-4-20250514` |
| **ollama** | `http://localhost:11434/v1` | Not required | `llama3.2` |
| **lmstudio** | `http://localhost:1234/v1` | Not required | `default` |
| **custom** | `http://localhost:8000/v1` | Not required | `default` |

Ollama, LM Studio, and custom providers use OpenAI-compatible API endpoints internally.

### Provider Features

| Feature | OpenAI | Anthropic | Local (Ollama/LM Studio/Custom) |
|---------|:------:|:---------:|:-------------------------------:|
| Streaming | Yes | Yes | Yes |
| Tool use | Yes | Yes | Yes (model-dependent) |
| Vision/images | Yes | Yes | Yes (model-dependent) |
| Retry on 429/5xx | Yes | Yes (max 3 retries, exponential backoff) | Yes |

---

## Model Management

Models are stored in `~/.deepa/models.json` with API keys encrypted using **AES-256-GCM**. The encryption key is derived from your machine's hostname and username — the file is not portable across machines.

### CLI Commands

```bash
deepa model add              # Interactive model setup
deepa model list             # List all models (keys masked)
deepa model remove <name>    # Remove a model
deepa model default <name>   # Set default model
```

### REPL Commands

```
/model add               # Interactive model setup
/model list              # List all models
/model remove <name>     # Remove a model
/model default <name>    # Set default model
/model use <name>        # Switch model for current session
```

The first model added is automatically set as default. If the default model is removed, the first remaining model becomes the new default.

---

## MCP Server Integration

Deepa supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) for connecting to external tool servers. MCP tools are automatically registered alongside built-in tools.

### Supported Transports

| Transport | Type | Config |
|-----------|------|--------|
| **stdio** | Local subprocess | `command` + `args` |
| **SSE** | Server-Sent Events (remote) | `url`, `transport: "sse"` |
| **Streamable HTTP** | HTTP streaming (default for remote) | `url` |

### Adding MCP Servers

```bash
# CLI — local server (stdio transport)
deepa mcp add my-tools npx -y @modelcontextprotocol/server-filesystem /tmp

# CLI — remote server (SSE)
deepa mcp add-remote my-remote https://mcp.example.com/sse sse

# CLI — remote server (HTTP streaming, default)
deepa mcp add-remote my-remote https://mcp.example.com

# List and remove
deepa mcp list
deepa mcp remove my-tools
```

```
# Inside REPL
/mcp add my-tools npx -y @modelcontextprotocol/server-filesystem /tmp
/mcp add-remote my-remote https://api.example.com/mcp sse
/mcp list
/mcp remove my-tools
```

### Project-level MCP

Add MCP servers to your `.deepa.json` for project-specific tools:

```json
{
  "mcpServers": {
    "db-tools": {
      "command": "npx",
      "args": ["-y", "@my-org/db-mcp-server"]
    },
    "remote-api": {
      "url": "https://api.example.com/mcp",
      "transport": "sse"
    }
  }
}
```

Global servers (`~/.deepa/mcp.json`) and project servers (`.deepa.json`) are merged — project servers override globals with the same name.

### Tool Naming

MCP tools are registered with the naming convention `mcp_{serverName}_{toolName}`. They default to `medium` risk level and pass through the original tool schema to the LLM provider.

---

## Skills System

Skills provide tested workflows, scripts, and best practices that the agent can load on demand. Deepa follows Claude's official [Agent Skills pattern](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) with **progressive disclosure**.

### How It Works

1. **Startup** — only skill metadata (name + description) is loaded into the system prompt
2. **On demand** — when the agent decides a skill matches the task, it calls `use_skill` to read the full instructions from `SKILL.md`
3. **Referenced files** — skills can reference additional files (e.g., `FORMS.md`, `scripts/`) loaded via `use_skill` with the `file` parameter

The system prompt instructs the agent to **check available skills BEFORE writing code**. If a skill matches, it MUST be loaded first.

### Skill Directories

Skills are loaded from these directories (in order, last wins for duplicates):

1. `~/.deepa/skills/` — global user skills
2. `~/.agents/skills/` — shared agent skills
3. `<project>/.deepa/skills/` — project-specific skills
4. `<project>/.agents/skills/` — project-specific agent skills

### Creating a Skill

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
~/.deepa/skills/my-skill/
├── SKILL.md           # Required — frontmatter + instructions
├── FORMS.md           # Optional — referenced files
├── REFERENCE.md       # Optional
└── scripts/           # Optional — helper scripts
    └── generate.py
```

**SKILL.md format:**

```markdown
---
name: my-skill
description: Short description of what this skill does and when to use it. Include trigger phrases like "Use when the user mentions X, Y, or Z."
allowed-tools: shell, file_write, web_fetch
---

## Instructions

Your detailed instructions here. The agent reads this only when the skill is activated.

See also: [FORMS.md](FORMS.md) for form templates.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No (defaults to directory name) | Lowercase letters, numbers, hyphens only. Max 64 characters. Must not contain reserved words (`anthropic`, `claude`) |
| `description` | Yes | What the skill does and when to trigger it. Max 1024 characters. Must not contain XML tags. **This is the trigger mechanism** — write it so the LLM knows when to activate the skill |
| `allowed-tools` | No | Comma-separated list of tools this skill may use |

### Viewing Installed Skills

```
/skills
```

### Best Practices for Skill Descriptions

The `description` field is what the LLM sees in the system prompt to decide whether to use a skill. Write descriptions that:

- Explain **what** the skill does
- Explain **when** to use it (trigger phrases)
- Include keywords the user might mention

**Good:** `"Build scalable design systems with Tailwind CSS v4, design tokens, component libraries, and responsive patterns. Use when creating component libraries, implementing design systems, or standardizing UI patterns."`

**Bad:** `"Tailwind CSS skill"`

---

## Sessions & Memory

### Sessions

Every conversation is automatically saved as a session file in `~/.deepa/sessions/`. Sessions include the full message history with all tool calls and results.

```bash
# Resume the latest session
deepa --resume
```

```
# Inside REPL
/session    # View current session info
```

### Memory

Deepa maintains persistent memory across sessions at two scopes:

- **Global memory** (`~/.deepa/memory/global/`) — shared across all projects
- **Project memory** (`~/.deepa/memory/projects/{name}_{hash}/`) — scoped to a specific project directory

The project key uses a collision-resistant format: `{basename}_{sha1-of-absolute-path}`.

```
/memory    # View all memory entries (global + project)
```

The agent can read and write memory entries to remember context, preferences, and decisions across sessions.

### Conversation Compaction

For long conversations approaching context limits, compact the history:

```
/compact   # Keep only the last 4 messages
```

---

## Image Support

Deepa supports vision/image analysis with compatible LLM providers (OpenAI, Anthropic, and vision-capable local models).

**Supported formats:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
**Recommended max size:** 5MB (files larger than 5MB will show a warning)

### Attach an Image

```
/image ./screenshot.png What's wrong with this UI?
```

### Paste from Clipboard (macOS)

```
/paste Analyze this screenshot
```

Or press **Ctrl+V** while typing to paste a clipboard image.

### Auto-detection

Image paths in your message are automatically detected and attached:

```
Look at ./error.png and fix the layout
```

---

## Web UI

Deepa includes two web-based interfaces:

### Chat UI

```bash
deepa ui                  # Start on default port 3001
deepa ui --port 8080      # Custom port
```

Opens a browser-based interface with:
- Full conversation with streaming responses
- Session management (left panel)
- **Settings panel** (right panel, gear icon) with tabs for:
  - **Models** — add, remove, set default, view all configured models with provider presets
  - **MCP Servers** — add local (stdio) or remote (SSE/HTTP) servers, remove servers
  - **Skills** — view installed skills and descriptions
- Model switching and autonomy toggle in the top bar
- File upload and image paste support

---

## Project Context (AGENTS.md)

Deepa automatically loads project context from these files (first found wins):

- `AGENTS.md`
- `CLAUDE.md`
- `.agents.md`

**Search locations:**
1. Project root directory (current working directory)
2. `~/.deepa/` (global fallback)

The content is injected into the system prompt to give the agent project-specific guidance — coding conventions, architecture notes, preferred tools, etc.

---

## Development

```bash
# Build TypeScript
npm run build

# Development mode (with tsx for auto-reload)
npm run dev

# Run tests (299 tests)
npm test

# Watch mode tests
npm run test:watch

# Type checking
npm run lint
```

---

## Project Structure

```
src/
├── index.ts              # CLI entry point and REPL
├── types.ts              # Shared type definitions
├── config.ts             # Configuration loader
├── agent/
│   ├── loop.ts           # Core agentic loop (think → act → verify)
│   └── prompts.ts        # System prompt builder
├── providers/
│   ├── base.ts           # LLM provider interface
│   ├── registry.ts       # Provider factory
│   ├── openai.ts         # OpenAI provider
│   ├── anthropic.ts      # Anthropic provider
│   └── local.ts          # Local/OpenAI-compatible provider
├── tools/
│   ├── registry.ts       # Tool registry
│   ├── file-read.ts      # file_read tool
│   ├── file-write.ts     # file_write tool
│   ├── file-edit.ts      # file_edit tool
│   ├── file-list.ts      # file_list tool
│   ├── search-grep.ts    # search_grep tool
│   ├── search-files.ts   # search_files tool
│   ├── shell.ts          # shell tool
│   ├── todo.ts           # todo tool
│   ├── web-search.ts     # web_search tool
│   ├── web-fetch.ts      # web_fetch tool
│   ├── git-worktree.ts   # git_worktree tool
│   └── use-skill.ts      # use_skill tool
├── plugins/
│   └── skills.ts         # Skill loader and registry
├── context/
│   ├── agents-md.ts      # AGENTS.md loader
│   ├── history.ts        # Session management
│   └── memory.ts         # Persistent memory
├── store/
│   ├── models.ts         # Encrypted model storage
│   └── mcp.ts            # MCP server storage
├── mcp/
│   └── client.ts         # MCP client (stdio, SSE, HTTP)
├── server/
│   └── ui-server.ts      # Web UI server (chat + settings APIs)
└── ui/
    ├── renderer.ts       # Terminal UI (colors, prompts, spinners)
    ├── stream-renderer.ts # Streaming markdown renderer
    ├── image.ts          # Image loading and clipboard
    └── history.ts        # Input history persistence
```

---

## License

MIT
