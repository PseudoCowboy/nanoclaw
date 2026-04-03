---
name: codex
description: Use OpenAI Codex CLI for coding tasks — generate code, debug, refactor, review, and execute multi-step coding workflows using GPT models. Codex can read repositories, make edits, run commands, search the web, and work with images. Use it for tasks that benefit from a second AI perspective, parallel work, or GPT-specific strengths. Requires copilot-api proxy running on host.
allowed-tools: Bash(codex:*)
---

# Codex CLI

Codex is OpenAI's coding agent CLI. It can read your repository, make edits, run commands, do code review, search the web, and work with images — all autonomously.

## Prerequisites

The `copilot-api-responses` proxy must be running on the host machine (port 4142). The container reaches it via `host.docker.internal:4142`. If the proxy is not running, Codex commands will fail with connection errors.

## Non-interactive mode (required for agents)

Always use `codex exec` for non-interactive execution. Never use bare `codex` — it opens an interactive TUI that won't work in this environment.

```bash
# Basic usage
codex exec "explain this codebase"

# With a specific model
codex exec --model gpt-5.4 "optimize this algorithm"

# Target a specific directory
codex exec --cd /path/to/project "fix the failing tests"

# Work across multiple directories
codex exec --cd apps/frontend --add-dir ../backend "coordinate the API changes"
```

## What Codex can do

### Generate and edit code
```bash
codex exec "write a Python function to parse CSV files with error handling"
codex exec "add input validation to the user registration endpoint"
codex exec "refactor this module to use async/await"
```

### Debug and fix
```bash
codex exec "fix the CI failure"
codex exec "find and fix the race condition in the worker pool"
codex exec "debug why the tests are failing and fix them"
```

### Code review
```bash
# Review uncommitted changes
codex exec "review the uncommitted changes and report issues"

# Review against a branch
codex exec "review the diff against main and highlight risks"
```

Codex has a built-in `/review` system with presets for reviewing against branches, uncommitted changes, specific commits, or custom review instructions. In `exec` mode, describe what you want reviewed in the prompt.

### Web search
Codex has built-in web search — it can look up documentation, current APIs, package versions, etc. without needing a browser:

```bash
codex exec "look up the latest React 19 API changes and summarize them"
codex exec --search "find the current best practices for Node.js error handling"
```

Use `--search` to force live web results instead of cached ones.

### Image inputs
Codex can read screenshots and images alongside prompts:

```bash
codex exec -i screenshot.png "explain this error"
codex exec --image mockup.png "implement this UI design"
codex exec --image img1.png,img2.jpg "compare these two designs"
```

### Multi-file and project-wide tasks
```bash
codex exec "add authentication middleware to all API routes"
codex exec "migrate the codebase from CommonJS to ES modules"
codex exec --cd /workspace/group/my-project "set up the project structure with tests"
```

## Models

- **gpt-5.4** (recommended) — frontier coding + strong reasoning
- **gpt-5.3-codex** — specialized for coding tasks

Switch models:
```bash
codex exec --model gpt-5.4 "your prompt"
```

## Resuming sessions

Codex stores transcripts locally. Resume previous work to avoid repeating context:

```bash
# Resume the most recent session
codex exec resume --last "now fix the edge cases you found"

# Resume a specific session
codex exec resume <SESSION_ID> "implement the plan"
```

## When to use Codex vs Claude's own tools

| Use Codex for | Use Claude's tools for |
|---------------|----------------------|
| Large refactors across many files | Quick single-file edits |
| Second opinion / code review | Reading and understanding code |
| Web search for current docs/APIs | Tasks using mounted project files |
| Image-based tasks (screenshots, mockups) | Structured data extraction |
| Parallel coding subtasks | Conversation and planning |
| GPT-specific strengths | Tasks needing IPC or NanoClaw tools |

## Tips

- **Always use `codex exec`** — bare `codex` opens an interactive TUI that won't work here
- **Be specific in prompts** — describe the task, expected outcome, and constraints
- **Use `--cd`** to point Codex at the right directory rather than relying on cwd
- **Resume sessions** for multi-step work — avoids re-reading the codebase each time
- **Combine with Claude** — use Codex for generation/review, then verify with Claude's tools
- **Check results after** — Codex modifies files directly; review changes before committing

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Connection refused | Ensure `copilot-api-responses` proxy is running on host port 4142 |
| Authentication error | Check `echo $COPILOT_API_KEY` — should be set automatically |
| Model not found | Try `--model gpt-5.4` or check proxy logs |
| Timeout | Break large tasks into smaller prompts, or resume the session |
| Interactive TUI launched | You used bare `codex` — always use `codex exec` instead |
