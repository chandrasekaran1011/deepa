# Agent Deepa

**Universal agentic CLI coding agent — securely supporting OpenAI, Anthropic, local LLMs, MCP, plugins, and custom skills.**

Deepa is a powerful agentic software development assistant that runs directly on your machine. Created to help development teams write, debug, refactor, and understand code autonomously, it serves as an advanced AI pair programmer. Deepa has secure, managed access to your local filesystem, shell, and development tools, making it a capable autonomous agent.

This guide provides everything needed to install, configure, and evaluate Deepa capabilities across different operating systems and workflows.

---

## Table of Contents

- [Core Concepts](#core-concepts)
- [Installation Guide](#installation-guide)
  - [macOS Installation](#macos)
  - [Windows Installation](#windows)
- [LLM & Model Setup](#llm--model-setup)
- [Agent Modes & Autonomy](#agent-modes--autonomy)
- [Model Context Protocol (MCP)](#model-context-protocol-mcp)
- [Skills System](#skills-system)
- [Memory & Sessions](#memory--sessions)
- [Web UI](#web-ui)
- [Evaluation Quick Start](#evaluation-quick-start)

---

## Core Concepts

Deepa is distinct from traditional chat-based coding assistants (like Copilot Chat) because it is fully **agentic**:
1. **Tool Use:** It can list directories, read files, edit files, and run terminal commands to test its own code.
2. **Autonomous Loop:** It follows a **Think → Act → Verify** loop, meaning it doesn't just write code; it runs it, catches errors, and fixes them automatically until the task is complete.
3. **Pluggable Architecture:** Deepa directly answers the "how do I make the AI know about my private API?" problem using the skills system and MCP servers.

---

## Installation Guide

Deepa requires **Node.js 18 or higher** and **npm** installed on your system.

### macOS

The easiest way to install Deepa on macOS is using our automated installation script:

Open Terminal and run:
```bash
curl -fsSL https://raw.githubusercontent.com/chandrasekaran1011/deepa/main/scripts/install.sh | bash
```
This script will automatically detect your environment, install the latest pre-compiled binary for your architecture, and add it to your PATH.

### Windows

The easiest way to install Deepa on Windows is using our automated installation script:

Open PowerShell (as Administrator) and run:
```powershell
iwr -useb https://raw.githubusercontent.com/chandrasekaran1011/deepa/main/scripts/install.ps1 | iex
```
This script will download and install the latest executable for Windows and ensure it's available in your system PATH.

---

## LLM & Model Setup

Deepa acts as the agent "brain", but it requires an LLM provider to function. It supports cloud providers (OpenAI, Anthropic) and completely offline, local LLMs (Ollama, LM Studio) for maximum data privacy.

**API keys are encrypted at rest** using AES-256-GCM, tied to the specific machine's hostname and username.

### Adding Your First Model

Run the Deepa CLI from your terminal:
```bash
deepa
```

Once inside the interactive prompt, type:
```
/model add
```

You will be prompted to enter:
1. **Name:** A friendly label (e.g., `gpt-5.2`, `claude-4.6`, `local-llama`)
2. **Provider:** Select from `openai`, `anthropic`, `ollama` (for local offline models), `lmstudio`, or `custom`.
3. **Model String:** The exact API model name (e.g., `gpt-5.2`, `claude-4-6-sonnet-latest`).
4. **API Key:** Paste your key. (Leave blank if using local models).

You can list, remove, or change your active model at any time:
```
/model list
/model use claude-3.5
```

---

## Agent Modes & Autonomy

Deepa's behavior is highly configurable based on how much autonomy you wish to grant it.

### Modes
Switch modes inside Deepa using slash commands:
- `/chat`: Standard question/answer mode without aggressive tool use.
- `/plan`: Read-only. The agent researches the codebase and creates a detailed implementation plan without making any file changes.
- `/exec`: **(Default)** Fully autonomous mode. The agent assumes a task, plans it, changes files, runs tests, and verifies completion.

### Autonomy Levels
Controls what actions the agent can perform without asking for explicit user permission.
- **Low:** Deepa will pause and ask for Y/N approval before executing *any* tool (reads, writes, or shell commands).
- **Medium (Default):** Deepa will automatically read files and write code, but will ask for permission before executing potentially destructive shell commands.
- **High:** Deepa operates fully autonomously, only pausing for extremely high-risk commands.

Set autonomy via CLI: `deepa -a medium` or inside the app: `/autonomy medium`.

---

## Model Context Protocol (MCP)

[MCP](https://modelcontextprotocol.io/) is an open standard that allows Deepa to seamlessly access secure, external tools, APIs, and databases. Instead of hard-coding Jira, GitHub, or Postgres integrations into Deepa, you connect an external "MCP Server".

When an MCP Server is connected, Deepa instantly understands how to use its tools (e.g., querying a database or reading a Jira ticket) to complete tasks.

### Connecting an MCP Server
You can connect local tools (stdio) or remote enterprise tools (SSE/HTTP). Inside Deepa:

```text
# Adding a local tool (e.g., giving Deepa access to the entire computer filesystem)
/mcp add my-tools npx -y @modelcontextprotocol/server-filesystem /path/to/allow

# Adding a remote service over SSE
/mcp add-remote jira-tools https://internal-mcp.yourcompany.com/sse sse
```
To view active connections: `/mcp list`

---

## Skills System

The Skills System allows you to explicitly teach Deepa your organization's internal workflows, coding standards, and proprietary APIs. It utilizes "progressive disclosure" so the agent only loads the skill when it's relevant to the prompt, saving tokens and improving accuracy.

### How to Evaluate Skills

Skills are directories located in `~/.deepa/skills/` (global) or `.deepa/skills/` (project-specific).

To create a skill:
1. Create a folder: `.deepa/skills/design-system`
2. Create a `SKILL.md` inside it.

```markdown
---
name: internal-design-system
description: Use this skill when the user asks to build UI components, react forms, or style frontend code.
---
# Internal Design Guidelines
Always use our custom `@acme/ui-kit` library. Do not use standard HTML `<button>` tags, always import `<AcmeButton>` from the UI kit.
```

When you ask Deepa to "Build a login form", the agent reads the description, realizes it needs this skill, loads the `SKILL.md` file, and uses `<AcmeButton>` instead of a standard `button`.

View all loaded skills with `/skills`.

---

## Memory & Sessions

Deepa is designed to learn about your projects over time.

### Persistent Memory
When you correct Deepa or explain an architectural concept, it stores that information in an intelligent vector-style memory bank.
- **Global Memory:** Learnings applied to all projects (e.g., "I prefer TypeScript over JavaScript").
- **Project Memory:** Architecture specific to the current codebase.

View what Deepa has learned by typing `/memory`.

### Sessions
Every execution is recorded. If you close the terminal, you can resume the exact conversation state by running:
```bash
deepa --resume
```

---

## Web UI

For a more premium, visual experience, Deepa ships with a built-in React-based Web UI. This UI is actively synchronized with the CLI backend.

To launch the UI:
```bash
deepa ui
```
This will open `http://localhost:3001` in your browser. The left panel shows your session history, the main pane is the chat interface, and the gear icon in the top right opens the settings panel to visually manage Models, MCP Servers, and Skills.

---

## Evaluation Quick Start

To effectively test Deepa's capabilities, we recommend the following flow:

1. **Install** via the instructions above.
2. **Add a Model** using `/model add` (We strongly recommend `gpt-5.2` or `claude-4.6-sonnet` for advanced agentic performance).
3. **Test Code Analysis:** Copy Deepa into a complex existing project. Run `deepa` and ask: *"Can you review the overall architecture of this project and explain where API requests are handled?"*
4. **Test Autonomous Execution:** Find a minor bug or refactoring task. Ask: *"In Exec mode, find the authentication helper and refactor it to include Winston logging. Run any tests related to it."*
5. **Test the UI:** Run `deepa ui` to evaluate the business-facing visual experience.

---
*For support or advanced configurations during testing, please refer to the project maintainers.*

