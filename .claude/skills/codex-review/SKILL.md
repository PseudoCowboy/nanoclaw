---
name: codex-review
description: Use Codex (GPT-5.4) as a second-opinion code reviewer or for parallel coding tasks. Invoke when user asks for Codex review, second opinion, GPT perspective, or wants to compare Claude vs Codex output. Also useful for large refactors, web search for current docs, and image-based tasks.
---

# Codex Code Review & Second Opinion

Use Codex CLI on the host to get a GPT-5.4 perspective on code changes, architecture decisions, or implementation quality.

## When to Use

- User asks for "codex review", "second opinion", "GPT perspective"
- Comparing Claude vs Codex output on the same task
- Large codebase-wide reviews that benefit from a fresh pair of eyes
- Web search for current documentation or API changes
- Image-based reviews (screenshot of UI, error, etc.)

## How to Run

**Always use `codex exec` with `--dangerously-bypass-approvals-and-sandbox`** on the host. The sandbox (bubblewrap) doesn't work in this environment.

### Code Review (most common)

```bash
# Review uncommitted changes
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Review the uncommitted changes in this repo. Report: bugs, logic errors, missing edge cases, style issues, and security concerns. Be specific with file:line references."

# Review a specific file
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Review src/channels/discord-commands.ts for code quality, maintainability, and potential bugs. Be specific."

# Review diff against a branch
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Review the diff between HEAD and main. Focus on correctness and risks."

# Review with specific focus
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Review src/container-runner.ts for security issues, especially around environment variable handling and mount paths."
```

### Summarize & Analyze

```bash
# Summarize a module
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Summarize the architecture of the Discord multi-agent workflow. Save to summary.md"

# Compare approaches
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Compare the polling approach in workspace watchers vs using fs.watch(). Which is better for this codebase?"
```

### Save output to file

When saving Codex output to a file, include the save instruction in the prompt:

```bash
codex exec --model gpt-5.4 --dangerously-bypass-approvals-and-sandbox \
  "Review X and save your findings to codex-review-output.md"
```

## Key Flags

| Flag | Purpose |
|------|---------|
| `--model gpt-5.4` | Use the frontier GPT model |
| `--dangerously-bypass-approvals-and-sandbox` | Required on this host (bwrap fails) |
| `--full-auto` | Alternative to bypass flag, also skips approvals |
| `--cd /path` | Point Codex at a specific directory |
| `--image file.png` | Attach screenshot for visual review |
| `--search` | Force live web search |

## Workflow: Claude + Codex Review

1. Claude writes code or analyzes a problem
2. Run Codex with a focused review prompt
3. Claude reads Codex output and synthesizes both perspectives
4. Present combined findings to user

## Timeout

Codex reviews can take 1-5 minutes depending on scope. Use `timeout: 600000` (10 min) for large reviews.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `bwrap: loopback: Failed RTM_NEWADDR` | Use `--dangerously-bypass-approvals-and-sandbox` |
| Connection refused | Check `systemctl --user status copilot-api-responses` on host |
| Codex hangs | Break prompt into smaller scope |
| Output too large | Ask Codex to save to file instead of stdout |
