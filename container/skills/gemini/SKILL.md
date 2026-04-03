---
name: gemini
description: Use Google Gemini CLI for coding tasks — generate code, debug, refactor, review, search the web, and execute multi-step workflows using Gemini models via Google OAuth. Good for tasks that benefit from a different AI perspective, Google's latest models, or built-in web search. No API key needed — uses Google OAuth.
allowed-tools: Bash(gemini:*)
---

# Gemini CLI

Gemini is Google's coding agent CLI. It can read your repository, make edits, run commands, search the web, and work autonomously using Gemini models. Authenticated via Google OAuth (no API key needed).

## Non-interactive mode (required for agents)

Always use `gemini -p` (or `--prompt`) for non-interactive execution. Never use bare `gemini` — it opens an interactive REPL that won't work in this environment.

```bash
# Basic usage
gemini -p "explain this codebase"

# With a specific model
gemini -p "optimize this algorithm" --model pro

# Full auto-approve mode (no confirmations)
gemini -p "fix the failing tests" --approval-mode yolo

# Get JSON output (useful for parsing results)
gemini -p "list all API endpoints" --output-format json

# Stream JSON output (for long-running tasks)
gemini -p "refactor the auth module" --output-format stream-json
```

## What Gemini can do

### Generate and edit code
```bash
gemini -p "write a Python function to parse CSV files with error handling"
gemini -p "add input validation to the user registration endpoint"
gemini -p "refactor this module to use async/await" --approval-mode yolo
```

### Debug and fix
```bash
gemini -p "fix the CI failure" --approval-mode yolo
gemini -p "find and fix the memory leak in the worker pool"
gemini -p "debug why the tests are failing and fix them" --approval-mode yolo
```

### Code review and analysis
```bash
gemini -p "review the code in src/ for security issues"
gemini -p "explain the architecture of this project"
gemini -p "find potential bugs in the recent changes"
```

### Web search (built-in)
Gemini has built-in web search capabilities — it can look up documentation, current APIs, and recent information:

```bash
gemini -p "look up the latest Node.js 22 API changes and summarize them"
gemini -p "find the current best practices for container security"
```

### Pipe content for analysis
```bash
# Analyze a file
cat error.log | gemini -p "explain these errors and suggest fixes"

# Analyze command output
git diff | gemini -p "review these changes"
```

### Multi-directory workspace
```bash
# Include additional directories
gemini -p "coordinate API changes across frontend and backend" \
  --include-directories ../backend,../shared
```

## Models

| Alias | Model | Best for |
|-------|-------|----------|
| `auto` (default) | `gemini-2.5-pro` | General tasks — auto-selects best model |
| `pro` | `gemini-2.5-pro` | Complex reasoning, large refactors |
| `flash` | `gemini-2.5-flash` | Fast, balanced — good for most tasks |
| `flash-lite` | `gemini-2.5-flash-lite` | Fastest — simple questions, quick edits |

Switch models:
```bash
gemini -p "your prompt" --model flash       # fast
gemini -p "your prompt" --model pro         # thorough
gemini -p "your prompt" --model flash-lite  # quickest
```

## Approval modes

| Mode | Flag | Description |
|------|------|-------------|
| Default | (none) | Asks before edits and commands |
| Auto-edit | `--approval-mode auto_edit` | Auto-approves file edits, asks for commands |
| YOLO | `--approval-mode yolo` | Auto-approves everything (use for autonomous tasks) |

For agent use, `--approval-mode yolo` is usually appropriate since you're already reviewing the results.

## Resuming sessions

Gemini stores session transcripts. Resume previous work to avoid re-reading the codebase:

```bash
# Resume the most recent session
gemini -p "now fix the edge cases you found" --resume latest

# Resume a specific session by index
gemini -p "implement the plan" --resume 5
```

## Output formats

```bash
# Plain text (default)
gemini -p "explain this code"

# JSON (structured, easy to parse)
gemini -p "list all functions" --output-format json

# Streaming JSON (for long tasks, get results incrementally)
gemini -p "refactor the module" --output-format stream-json
```

## When to use Gemini vs other tools

| Use Gemini for | Use Claude's tools for | Use Codex for |
|----------------|----------------------|---------------|
| Google model strengths | Direct file read/edit | GPT model strengths |
| Built-in web search | Structured IPC tasks | Copilot-backed models |
| Quick code analysis | Planning & conversation | Image-based tasks |
| Second AI opinion | NanoClaw-specific tools | Multi-agent workflows |
| Fast tasks (flash-lite) | Precise file edits | Session resumption |

## Tips

- **Always use `-p`** — bare `gemini` opens an interactive REPL that won't work here
- **Use `--approval-mode yolo`** for autonomous tasks where you'll review the results
- **Use `--model flash-lite`** for quick, cheap questions and simple edits
- **Use `--model pro`** for complex reasoning, large refactors, and architecture decisions
- **Use `--output-format json`** when you need to parse the result programmatically
- **Pipe content** with `cat file | gemini -p "analyze"` for targeted analysis
- **Resume sessions** for multi-step work — `--resume latest` keeps context
- **Combine with Claude** — use Gemini for generation/review, then verify with Claude's tools

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Auth error / credentials expired | Google OAuth needs refresh — run `gemini` interactively on the host to re-auth |
| Interactive REPL launched | You used bare `gemini` — always use `gemini -p "prompt"` |
| Model not found | Use an alias: `auto`, `pro`, `flash`, or `flash-lite` |
| Timeout | Use `--model flash-lite` for faster responses, or break into smaller prompts |
| Sandbox errors | Add `--approval-mode yolo` to bypass sandbox restrictions |
