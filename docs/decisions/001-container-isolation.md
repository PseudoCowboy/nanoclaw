# ADR-001: Container Isolation for Agent Execution

**Date:** 2026-04-03
**Status:** Accepted
**Deciders:** Human owner

## Context

NanoClaw needs to run AI agents that can execute arbitrary code — Bash commands, file operations, git commands, and more. Running these agents directly on the host is unsafe: they could read secrets (API keys, `.env` files), modify the application itself, or interfere with each other when running concurrently.

We need an isolation boundary that is strong enough to contain untrusted code execution while still giving agents access to the specific files and tools they need to do useful work.

## Decision

Each agent invocation runs in a fresh Docker container with tightly scoped access:

- **Bind-mounted group directory** — isolated per agent/group, so each agent only sees its own group's files
- **Bind-mounted shared project directory** — scoped by `projectSlug`, giving agents access to the codebase they're working on
- **Per-agent git worktrees** — each agent gets its own worktree for branch isolation, preventing concurrent agents from interfering with each other's git state
- **Secret stripping via PreToolUse SDK hook** — a hook removes `ANTHROPIC_API_KEY` from every Bash subprocess environment, so tools like Codex/Gemini running inside the container can't extract it
- **Host credential proxy** — `copilot-api` services on ports 4141 and 4142 handle authentication on the host side; containers never hold real API keys, only dummy tokens that the proxy validates
- **Gemini credentials mounted read-only** — Google OAuth credentials from the host's `~/.gemini/` are mounted read-only into containers

## Consequences

**What becomes easier:**

- Strong isolation — agents cannot read `.env`, modify host code, or access other groups' data
- Per-agent worktrees eliminate the "shared git checkout" problem where concurrent agents corrupt each other's working trees
- Clean state per invocation — no leftover files or environment from previous runs
- Security posture is straightforward to audit: inspect the container mounts and you know exactly what's exposed

**What becomes harder:**

- Container startup overhead of ~2-5 seconds per invocation adds latency to every agent response
- Must maintain the container image and rebuild when dependencies change (`container/build.sh`)
- Debugging requires inspecting container logs, not just host logs — adds a layer of indirection
- Volume mount configuration in `container-runner.ts` must be kept in sync with what agents actually need

**Why Docker over lighter alternatives:**

We chose Docker over lighter isolation mechanisms (chroot, Linux namespaces, gVisor) because Docker is boring technology — well-understood, well-documented, and battle-tested. The startup overhead is acceptable for our use case (conversational agents, not sub-second latency requirements). The operational simplicity of `docker run` with bind mounts outweighs the marginal performance gains from lighter-weight isolation.
