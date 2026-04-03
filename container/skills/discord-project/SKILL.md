# Discord Project Setup

Trigger: user says `!create_project NAME` or asks to set up a new project workspace.

## What This Does

Create a new project structure in the shared workspace and optionally set up Discord channels for it.

## Process

1. **Create project directory** in `/workspace/shared/`:
   ```bash
   mkdir -p /workspace/shared/projects/PROJECT_NAME/{src,tests,docs,plans,reviews,status}
   ```

2. **Create project README**:
   ```bash
   cat > /workspace/shared/projects/PROJECT_NAME/README.md << 'EOF'
   # PROJECT_NAME

   ## Overview
   [Description]

   ## Structure
   - `src/` — Source code
   - `tests/` — Test files
   - `docs/` — Documentation
   - `plans/` — Feature plans (Athena)
   - `reviews/` — Code reviews (Argus)
   - `status/` — Task status updates

   ## Agents
   - **Athena** — Plans features
   - **Atlas** — Backend implementation
   - **Apollo** — Frontend implementation
   - **Argus** — Code review
   EOF
   ```

3. **Notify the team** — use `send_message` to post in control-room that a new project is ready

## Notes

- All agents share `/workspace/shared/` — files written there are visible to everyone
- Each agent also has `/workspace/group/` for private notes
- The shared workspace persists across container restarts
