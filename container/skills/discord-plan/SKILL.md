# Discord Plan Orchestration

Trigger: user says `!plan FEAT-XXX description` or asks you to coordinate a planning session.

## What This Does

You orchestrate a multi-agent planning debate in Discord. The agent bots (Athena, Hermes) each have their own Discord accounts and listen in the `#plan-room` channel.

## Process

1. **Parse the request** — extract feature ID (FEAT-XXX) and description
2. **Kick off Round 1** — post `@Athena` in the plan-room channel with the feature request
3. **Wait for Athena's plan** — she'll create a spec in `/workspace/shared/plans/`
4. **Kick off Round 2** — post `@Hermes` asking to review
5. **Collect feedback** — Hermes finds issues and suggests alternatives
6. **Kick off Round 3** (if needed) — post `@Athena` with consolidated feedback for revision
7. **Summarize** — post final plan status in control-room

## How to Send Messages

Use `send_message` to post to Discord channels:
```bash
# Post to plan-room (replace CHANNEL_ID with actual Discord channel ID)
echo '{"type":"message","chatJid":"dc:CHANNEL_ID","text":"@Athena Round 1: Design a plan for FEAT-001 user authentication"}' > /workspace/ipc/messages/plan-$(date +%s).json
```

## Important Notes

- The agent bots are separate Discord users — they respond to @mentions automatically
- You don't control the agents directly — you post messages that trigger them
- Each round may take 30-60 seconds (container startup + AI processing)
- Check `/workspace/shared/plans/` for written artifacts
- The user sees the full debate in Discord in real-time
