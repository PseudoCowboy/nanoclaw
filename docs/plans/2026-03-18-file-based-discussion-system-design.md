# File-Based Collaborative Discussion System Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Replace the current chat-only `!create_discussion` workflow with a file-based collaborative system. Agents read and edit shared markdown files, commit as themselves via git, and chain to each other automatically. Three fixed rounds: Improvement → Disagreement → Resolution.

## Current State

The existing `!create_discussion` command:
1. Creates a `DISCUSSIONS` category and `#discuss-<slug>` channel
2. Runs a 3-round planning session where Iris mentions each agent in turn
3. Agents respond in Discord chat only — no file I/O, no git, no handoff

**What's missing:** No shared files, no git history, no agent-to-agent handoff, no disagreement tracking.

## Design

### Command & Setup

When user runs `!create_discussion "API redesign plan"`:

1. **Discord:** Create `DISCUSSIONS` category (if needed) → create `#discuss-api-redesign-plan`
2. **Filesystem:** Create `groups/shared_project/discuss-api-redesign-plan/` → `git init` inside it
3. **Welcome embed:** Posted with instructions — this is a file-based discussion with Prometheus, Athena, Hermes
4. **No auto-start.** User manually places markdown files in the shared subfolder, then `@Prometheus` with instructions

**Paths:**
- Host: `groups/shared_project/discuss-api-redesign-plan/`
- Container: `/workspace/shared/discuss-api-redesign-plan/`

The git repo is per-discussion for clean history per topic.

### Round 1 — Improvement Chain (Agents ↔ Human)

```
User @Prometheus "read plan.md and requirements.md, improve the plan"
    │
    ▼
Prometheus reads files from /workspace/shared/discuss-xyz/
    │ Multi-turn conversation with user (asks questions, user replies)
    │ Agent decides when it has enough info
    ▼
Prometheus saves improved plan as plan-v2.md
Prometheus commits: --author="Prometheus <prometheus@nanoclaw>"
Prometheus sends: "@Athena your turn — check plan-v2.md under discuss-xyz"
    │
    ▼
Athena reads plan-v2.md (and originals for context)
    │ Multi-turn conversation with user
    ▼
Athena edits plan-v2.md in place, commits as herself
Athena sends: "@Hermes your turn — check plan-v2.md under discuss-xyz"
    │
    ▼
Hermes reads plan-v2.md, converses with user, edits in place, commits as himself
Hermes sends: "✅ Round 1 complete."
    │
    ▼
Iris detects completion → posts round summary embed
```

**Key details:**
- Prometheus creates `plan-v2.md` from the originals. Athena and Hermes edit `plan-v2.md` in place.
- Three separate git commits, one per agent. `git blame plan-v2.md` shows who wrote which lines.
- Agents drive the conversation — they decide when they have enough info, save, and hand off.
- User can interrupt with `!pause` if needed.

### Round 2 — Disagreement Chain (Agents ↔ Agents, Human Observes)

```
Iris posts: "━━━ Round 2 — Review & Disagree ━━━"
Iris sends: "@Prometheus review plan-v2.md — if you disagree with any changes, challenge the agent who made them"
    │
    ▼
Prometheus re-reads plan-v2.md, checks git blame to see who changed what
    │ If disagrees: @mentions that agent in Discord, asks why
    │ The mentioned agent responds (listenToBots: true)
    │ They debate back and forth until resolved or agree to disagree
    │ Unresolved disagreements → writes to disagreements.md
    ▼
Prometheus commits disagreements.md as himself
Prometheus sends: "@Athena your turn — review plan-v2.md and disagreements.md"
    │
    ▼
Athena does the same: checks changes, challenges other agents directly
    │ Appends unresolved disagreements to disagreements.md
    ▼
Athena commits, sends: "@Hermes your turn"
    │
    ▼
Hermes does the same, appends disagreements, commits
Hermes sends: "✅ Round 2 complete."
    │
    ▼
Iris detects completion → posts round summary embed
```

**Key details:**
- No human in the loop. Agents debate each other directly. User watches in Discord.
- All agents write to the same `disagreements.md`, each appending a section with their name as header (e.g., `## Prometheus — Disagreements`).
- If an exchange resolves the issue, it doesn't go into disagreements.md — only unresolved points.

### Round 3 — Resolution (Iris Orchestrates)

```
Iris posts: "━━━ Round 3 — Resolve Disagreements ━━━"
Iris sends: "@Prometheus @Athena @Hermes read plan-v2.md and disagreements.md —
             state whether each disagreement point is still unresolved.
             If still disagree, re-describe it clearly."
    │
    ▼
Each agent responds in turn (Prometheus → Athena → Hermes)
    │ Reads plan-v2.md + disagreements.md
    │ For each disagreement: "resolved" or "still disagree — here's why: ..."
    │ Updates disagreements.md with final positions
    │ Commits as themselves
    │
    ▼
Iris collects the remaining unresolved points
Iris posts: "📋 Unresolved disagreements remain. @Human please share your thoughts."
    │
    ▼
User reads the disagreements, shares perspective in the channel
    │
    ▼
Iris sends: "@Hermes incorporate Human's input and produce the final version of plan-v2.md"
    │
    ▼
Hermes reads user's comments + plan-v2.md + disagreements.md
Hermes writes the final plan-v2.md incorporating user's decisions
Hermes commits as himself: "Final version incorporating human decisions"
Hermes sends: "✅ Discussion complete. Final plan is plan-v2.md"
    │
    ▼
Iris posts completion embed with summary
```

**If no disagreements after Round 2:** Iris skips human input, posts "All disagreements resolved ✅".

### Orchestration Approach — Hybrid

Agents chain via @mentions (Prometheus → @Athena → @Hermes). Iris monitors as a watchdog:

- If an agent doesn't hand off within 5 minutes, Iris nudges
- Iris handles round transitions (announcing "Round 2", "Round 3")
- Iris orchestrates Round 3 directly (needs to pause for human input)

### File Structure & Git

For a discussion called `"API redesign plan"`:

```
groups/shared_project/discuss-api-redesign-plan/
├── .git/                     # git init at creation time
├── plan.md                   # user places before starting
├── requirements.md           # user places before starting
├── plan-v2.md                # Prometheus creates in Round 1
└── disagreements.md          # Created in Round 2 if any disagreements
```

**Git config:**
- No global git config changes — each commit uses `--author` flag
- Authors: `Prometheus <prometheus@nanoclaw>`, `Athena <athena@nanoclaw>`, `Hermes <hermes@nanoclaw>`

**Expected git log after full discussion:**
```
# Round 3
abc1234 Hermes     — Final version incorporating human decisions
def5678 Hermes     — Round 3: final positions on disagreements
ghi9012 Athena     — Round 3: final positions on disagreements
jkl3456 Prometheus — Round 3: final positions on disagreements

# Round 2
mno7890 Hermes     — Round 2: review and disagreements
pqr1234 Athena     — Round 2: review and disagreements
stu5678 Prometheus — Round 2: review and disagreements

# Round 1
vwx9012 Hermes     — Improve plan based on review
yza3456 Athena     — Improve plan based on review
bcd7890 Prometheus — Create improved plan from initial files
```

### Agent Instructions

**Shared discussion skill:** `container/skills/discord-discussion/SKILL.md`

Contains the full discussion protocol. All three agents read it. Each agent's CLAUDE.md tells them who they are, so the shared skill says:
- "If you're in a `discuss-*` channel, follow this protocol"
- Round 1/2/3 behavior
- Git commit instructions: `git add . && git commit --author="YourName <yourname@nanoclaw>" -m "message"`
- Chain position: Prometheus=1st, Athena=2nd, Hermes=3rd (final authority)

**Per-agent CLAUDE.md updates** (`groups/dc_*/CLAUDE.md`):
- Small addition pointing to the discussion skill
- Chain position identifier

**Config change:** `agents/config.json` — Athena's `listenToBots` changes from `false` to `true`

## AI Tool Architecture Reference

All 6 agents run inside the **same Docker container image**. Claude Agent SDK is always the primary runtime. Inside that Claude session, the agent can call other AI tools via bash:

```
┌─────────────────── Docker Container ───────────────────┐
│                                                         │
│  Claude Agent SDK (always the primary runtime)          │
│  ├── Reads CLAUDE.md from /workspace/group/CLAUDE.md    │
│  ├── Reads skills from /home/node/.claude/skills/       │
│  │                                                      │
│  │  Tools available via bash:                           │
│  │  ├── codex exec "prompt"  → host:4142 (Copilot API) │
│  │  ├── gemini -p "prompt"   → Google API (OAuth)       │
│  │  ├── claude -p "prompt"   → host:4141 (Copilot API) │
│  │  └── (git, curl, etc.)                               │
│  │                                                      │
│  Mounts:                                                │
│  ├── /workspace/group/    ← groups/dc_{agent}/          │
│  ├── /workspace/shared/   ← groups/shared_project/      │
│  ├── /workspace/ipc/      ← per-group IPC               │
│  ├── /home/node/.claude/  ← per-group sessions + skills │
│  └── /home/node/.gemini/  ← host ~/.gemini/ (read-only) │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Files & Paths

| Component | Host Path | Container Path | Purpose |
|-----------|-----------|----------------|---------|
| Agent identity | `groups/dc_{name}/CLAUDE.md` | `/workspace/group/CLAUDE.md` | Who am I, what's my role |
| Shared workspace | `groups/shared_project/` | `/workspace/shared/` | Read/write collaboration files |
| Codex skill | `container/skills/codex/SKILL.md` | `/home/node/.claude/skills/codex/SKILL.md` | How to use `codex exec` |
| Gemini skill | `container/skills/gemini/SKILL.md` | `/home/node/.claude/skills/gemini/SKILL.md` | How to use `gemini -p` |
| Codex config | Baked in Dockerfile | `/home/node/.codex/config.toml` | Points to host:4142 proxy |
| Gemini creds | `~/.gemini/` | `/home/node/.gemini/` (read-only) | Google OAuth tokens |
| Claude proxy | N/A (env vars via stdin) | `ANTHROPIC_BASE_URL=host:4141` | Chat Completions API |
| Discussion skill | `container/skills/discord-discussion/SKILL.md` | `/home/node/.claude/skills/discord-discussion/SKILL.md` | Discussion protocol |

### How "Preferred Tool" Works

The CLAUDE.md tells the Claude agent "use Codex/Gemini for heavy lifting." Claude is always running — it delegates to the preferred tool:

| Agent | Primary Runtime | Preferred Tool | How It Calls It |
|-------|----------------|----------------|-----------------|
| Prometheus | Claude Agent SDK | Gemini | `gemini -p "prompt"` via bash |
| Athena | Claude Agent SDK | Codex | `codex exec "prompt"` via bash |
| Hermes | Claude Agent SDK | Claude | `claude -p "prompt"` via bash (or uses own tools directly) |

The agent can always read/write files directly using Claude's built-in tools. Git commands also work directly via bash. The preferred tool is for deeper analysis — the agent reads the task, calls its tool, and posts the result.

### Host Proxy Services

| Service | Port | Package | Protocol | Used By |
|---------|------|---------|----------|---------|
| `copilot-api` | 4141 | `copilot-api@0.7.0` | Chat Completions (`/v1/chat/completions`) | Claude Agent SDK (all agents) |
| `copilot-api-responses` | 4142 | `@jeffreycao/copilot-api` | Responses API (`/v1/responses`) | Codex CLI (Athena) |
| N/A | HTTPS | Google API | OAuth | Gemini CLI (Prometheus) |

### Codex CLI Details

- **Config:** `/home/node/.codex/config.toml` (baked in Dockerfile)
- **Model:** `gpt-5.4` (default)
- **Auth:** `COPILOT_API_KEY=dummy` env var (real auth handled by proxy)
- **Usage:** Always `codex exec "prompt"` — never bare `codex` (interactive TUI)
- **Proxy:** `copilot-api-responses` on host:4142, supports Responses API required by Codex
- **Capabilities:** Code generation, debugging, code review, web search, image analysis, session resumption

### Gemini CLI Details

- **Config:** Google OAuth creds in `/home/node/.gemini/` (mounted read-only from host)
- **Models:** `auto` (default, gemini-2.5-pro), `pro`, `flash`, `flash-lite`
- **Auth:** Google OAuth tokens, auto-refreshed by Gemini CLI
- **Usage:** Always `gemini -p "prompt"` — never bare `gemini` (interactive REPL)
- **No proxy needed** — direct HTTPS to Google API
- **Capabilities:** Code generation, debugging, code review, web search, pipe content analysis, session resumption
- **Approval mode:** Use `--approval-mode yolo` for autonomous tasks

### Claude CLI Details

- **Auth:** `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` passed via stdin JSON to container
- **Proxy:** `copilot-api` on host:4141, Chat Completions API
- **Security:** A `PreToolUse` hook strips `ANTHROPIC_API_KEY` from every Bash subprocess
- **Usage:** `claude -p "prompt"` for non-interactive, or used directly as the container's primary runtime

### Credential Renewal

| Tool | When | How |
|------|------|-----|
| Copilot API (4141) | GitHub token expires | `copilot-api auth` on host |
| Copilot Responses (4142) | GitHub token expires | `copilot-api-responses auth` on host |
| Gemini CLI | Google OAuth expires | Run `gemini` interactively on host, re-auth |

### Boot Status Check

`scripts/check-copilot-credentials.sh` runs on boot and every 6 hours:
1. Copilot API (4141) — models endpoint + test completion
2. Copilot Responses (4142) — models endpoint + test Responses API call
3. Gemini CLI — `gemini -p "hi"` with JSON output

Sends Telegram notification with per-service status.

## Implementation Touchpoints

| File | Change |
|------|--------|
| `src/channels/discord-commands.ts` | Rewrite `cmdCreateDiscussion`, add round tracking + Iris watchdog |
| `agents/config.json` | Athena `listenToBots: true` |
| `container/skills/discord-discussion/SKILL.md` | New — shared discussion protocol skill |
| `groups/dc_prometheus/CLAUDE.md` | Add discussion skill reference + chain position (1st) |
| `groups/dc_athena/CLAUDE.md` | Add discussion skill reference + chain position (2nd) |
| `groups/dc_hermes/CLAUDE.md` | Add discussion skill reference + chain position (3rd, final authority) |
| `src/container-runner.ts` | No changes needed (shared folder already mounted) |
