# Deepa CLI

> Universal AI coding agent for the terminal — supports OpenAI, Anthropic, Ollama, LM Studio, MCP, plugins, skills, and memory.

## Quick Start

```bash
# Install dependencies and build
npm install && npm run build

# Add your first model
deepa model add           # Interactive setup

# Or add quickly via CLI
deepa model add           # Then follow prompts for:
                          # - OpenAI (gpt-4o, etc.)
                          # - Anthropic (Claude)
                          # - Ollama (local, no key needed)
                          # - LM Studio (local, no key needed)
                          # - Custom endpoint

# Run
deepa                             # Interactive chat
deepa "explain this codebase"     # One-shot prompt
deepa plan "add auth"             # Plan mode
deepa exec "fix the bug"          # Execution mode
deepa --use-model claude "hello"  # Use a specific model
```

## Model Management

Models are stored **encrypted** in `~/.deepa/models.json`. API keys are encrypted with AES-256-GCM using a machine-derived key.

```bash
deepa model add              # Interactive: name, provider, model, endpoint, key
deepa model list             # Show all configured models
deepa model default claude   # Set default model
deepa model remove old-gpt   # Remove a model
```

Inside the REPL:
```
/model              — List models
/model add          — Add a new model
/model use <name>   — Switch to a model mid-session
/model default <n>  — Set default
/model remove <n>   — Remove
```

### Provider Presets

| Provider | Endpoint | Key Required | Default Model |
|----------|----------|:---:|---------------|
| `openai` | `api.openai.com/v1` | ✅ | `gpt-4o` |
| `anthropic` | `api.anthropic.com` | ✅ | `claude-sonnet-4-20250514` |
| `ollama` | `localhost:11434/v1` | ❌ | `llama3.2` |
| `lmstudio` | `localhost:1234/v1` | ❌ | `default` |
| `custom` | `localhost:8000/v1` | ❌ | `default` |

## MCP Servers

Managed globally in `~/.deepa/mcp.json` or per-project in `.deepa.json`. Deepa supports local MCP servers (via stdio) and remote MCP servers (via SSE or Streamable HTTP).

```bash
# Add a local executable MCP server
deepa mcp add fs npx -y @modelcontextprotocol/server-filesystem /tmp

# Add a remote MCP server (defaults to HTTP Stream, compatible with Mintlify/LangChain)
deepa mcp add-remote docs-langchain https://docs.langchain.com/mcp

# Add a remote MCP server explicitly using standard SSE
deepa mcp add-remote my-remote-server http://localhost:8000/sse sse

deepa mcp list
deepa mcp remove fs
```

Inside the REPL:
```
/mcp                                   — List servers
/mcp add <name> <cmd> [args]           — Add local server
/mcp add-remote <name> <url> [transp]  — Add remote server (sse or http)
/mcp remove <name>                     — Remove server
```

## Features

### 🛠️ Built-in Tools
| Tool | Description |
|------|-------------|
| `file_read` | Read files with optional line ranges |
| `file_write` | Create/overwrite files |
| `file_edit` | Search-and-replace edits |
| `file_list` | List directory contents |
| `search_grep` | Ripgrep-style code search |
| `search_files` | Find files by glob pattern |
| `shell` | Execute shell commands |
| `web_fetch` | Fetch URLs as markdown |
| `todo` | Task plan tracking |

### 🎯 Modes & Autonomy
- **Modes**: `chat`, `plan` (read-only), `exec` (full access)
- **Autonomy**: `suggest` (approve all), `ask` (approve writes), `auto` (full autonomy)

### 📁 `~/.deepa/` Directory
```
~/.deepa/
├── models.json    # Encrypted model configs
├── mcp.json       # MCP server configs
├── skills/        # Global SKILL.md files
├── plugins/       # Plugin modules
├── memory/        # Persistent memory
│   └── global/
└── sessions/      # Session history
```

### 📄 Context & Memory
- **AGENTS.md / CLAUDE.md** — loaded automatically from project root
- **Memory** — persistent across sessions (`~/.deepa/memory/`)
- **Sessions** — save/resume with `--resume`
- **Skills** — SKILL.md playbooks from `~/.deepa/skills/` or `.deepa/skills/`

## Development

```bash
npm run dev          # Run with tsx
npm run build        # Compile TypeScript
npm run lint         # Type-check
npm test             # Run tests (39 tests)
```

## License

MIT
