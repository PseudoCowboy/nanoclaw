# Codex Final Status Check

Checked against `/home/pseudo/.claude/plans/abstract-plotting-elephant.md`, `codex-review-round1.md`, and `codex-review-round2.md`.

## Verification Commands

- `npm run build` -> passed
- `npm test` -> failed
  - `src/channels/discord-commands.test.ts:432` (`!close_discussion` test expects `channel.delete()` call)
  - `src/channels/discord-commands.test.ts:548` (`!create_discussion` test expects welcome embed send)

## Part A: Documentation Fixes

| Item | Status | Findings |
|---|---|---|
| A1 `docs/discord-bot-summary.md` | Done | The stale channel-creation description is fixed. The file now says `!create_project` creates only `control-room`, `plan-room`, `release-log`, and that `ws-*` channels are created later by `!decompose` (`docs/discord-bot-summary.md:68-69`, `:166-182`). It also fixes the previously flagged command count (`18 total`) and skill count (`6 Discord-specific skills`). |
| A2 `multi-agent-file-first-workflow.md` | Partial | Prometheus references are gone and the top-level planning flow is updated to the 4-step Hermes -> Athena -> Hermes model (`multi-agent-file-first-workflow.md:15-18`, `:43-47`). But the file still contains stale content: it says `approved-plan.md` exists in the project control folder (`:67-72`) and still documents `!create_discussion` as a `3-round discussion` (`:136-140`). |
| A3 `container/skills/discord-plan/SKILL.md` | Done | The skill now describes Hermes-first orchestration via Discord @mentions rather than Athena-first IPC orchestration (`container/skills/discord-plan/SKILL.md:11-29`). |
| A4 `container/skills/discord-discussion/SKILL.md` | Done | The skill matches the implemented 4-step workflow, removes `disagreements.md`, and documents the actual Hermes -> Athena -> Hermes handoff chain (`container/skills/discord-discussion/SKILL.md:14-47`). |
| A5 `container/skills/discord-project/SKILL.md` | Partial | The old `/workspace/shared/projects/...` path is gone, and the root workspace shape now points at `groups/shared_project/active/<slug>/...` (`container/skills/discord-project/SKILL.md:11-36`). But it still overstates what `!create_project` creates: `initProjectWorkspace()` only scaffolds `control/`, `coordination/`, `workstreams/`, `archive/` plus coordination files and `lint-check.sh` (`src/channels/discord-commands/helpers.ts:108-187`). The skill implies per-workstream `tasks.md` and `task-state.json` already exist as part of initial project setup (`container/skills/discord-project/SKILL.md:23-34`), which is not true. |
| A6 `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` + `docs/GAP-ANALYSIS.md` | Partial | The planned stale claims are fixed: P2 now acknowledges worktree isolation, P4 acknowledges Argus's active review role, and both docs have updated datestamps (`docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md:3`, `:44-49`, `:68-72`; `docs/GAP-ANALYSIS.md:3`, `:37-48`, `:65-76`). However, `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` still says there are `17 commands` (`:5`) even though the command registry exposes 18 (`src/channels/discord-commands/index.ts:133-165`), and it claims restart recovery exists for planning sessions (`:151`) even though discussion restart recovery is still incomplete in practice. `docs/GAP-ANALYSIS.md` looks materially aligned. |
| A7 `container/skills/discord-review/SKILL.md` | Broken | This was not actually rewritten to the live Discord workstream review model. It still describes GitHub PR discovery, `gh pr diff`, `gh pr review`, `gh pr merge`, and PR-based escalation (`container/skills/discord-review/SKILL.md:3-97`). That does not match the implemented `task-state.json`/stream-watcher review flow. |

## Part B: Code Fixes

| Item | Status | Findings |
|---|---|---|
| B1 Dual-channel planning cleanup | Done | `DiscussionSession` now includes `sourceChannelId` (`src/channels/discord-commands/types.ts:9-18`). `cmdPlan()` persists `sourceChannelId` on the `plan-room` discussion session when the command starts in `control-room` (`src/channels/discord-commands/planning.ts:153-169`). The discussion completion handler removes both the live channel entries and the source-channel entries (`src/channels/discord-commands/discussion.ts:116-123`). This directly fixes the orphaned control-room session bug described in the plan. |
| B2 QA self-review | Done | The `implemented` state in `startStreamWatcher()` now checks `leadAgent === 'Argus'` and auto-approves instead of routing Argus to review itself (`src/channels/discord-commands/stream-watcher.ts:687-705`). That matches the intended fix for `ws-qa`. |
| B3 Rehydrate planning/discussion sessions on restart | Partial | Rehydration code for `planning_session` and `discussion_session` now exists (`src/channels/discord-commands/stream-watcher.ts:354-426`). But the fix is incomplete: `cmdCreateDiscussion()` persists round `0`, then later mutates the in-memory session to round `1` / `currentAgent='Hermes'` without calling `saveDiscussionSession()` (`src/channels/discord-commands/discussion.ts:291-304`, `:411-414`). Because `rehydrateOrchestrationState()` only restarts the watchdog when persisted `round > 0` (`src/channels/discord-commands/stream-watcher.ts:392-418`), active standalone discussions can still fail to resume correctly after restart. |

## Codex Review Follow-Up

### `codex-review-round1.md`

Resolved:

- Round 1 item 2: `sourceChannelId` is now persisted and used.
- Round 1 item 5: the specific P2/P7/P5 contradictions called out in `docs/DISCORD-WORKFLOW-VS-PRINCIPLES.md` were cleaned up.
- Round 1 item 7: `docs/discord-bot-summary.md` now uses 18 commands, 6 skills, and @mentions instead of IPC.
- Round 1 item 8: `docs/CHANGES_SINCE_SETUP.md` no longer uses the old `groups/telegram_main/discord-bot/agents/` section header.

Still unresolved:

- Round 1 item 1: restart recovery is still incomplete for discussion sessions, for the reasons described in B3.
- Round 1 item 3: `container/skills/discord-review/SKILL.md` is still the wrong GitHub-PR workflow.
- Round 1 item 4: `container/skills/discord-project/SKILL.md` still overstates initial scaffolding.
- Round 1 item 6: `docs/GAP-ANALYSIS.md` is mostly corrected, but `multi-agent-file-first-workflow.md` is still stale.
- Round 1 item 9: there is still no regression coverage for the restart/cleanup/review-gate paths. The current test file has no focused coverage for `rehydrateOrchestrationState()`, the `sourceChannelId` cleanup path, or the Argus auto-approve branch.

### `codex-review-round2.md`

Resolved:

- Round 2 item 4: the control-room welcome embed no longer claims `approved-plan.md` is scaffolded (`src/channels/discord-commands/project.ts:116-136`).

Still unresolved:

- Round 2 item 1: discussion restart recovery is still incomplete because not all round/current-agent transitions are durably saved.
- Round 2 item 2: `!decompose` can still miss the finalized `plan-v2.md` after planning completion. `discussion.ts` deletes the in-memory planning session on completion (`src/channels/discord-commands/discussion.ts:109-123`), while `cmdDecompose()` looks for current planning-session `plan-v2.md` files first and otherwise falls back to `control/approved-plan.md` or `control/draft-plan.md` (`src/channels/discord-commands/workstreams.ts:92-143`). Nothing copies the finalized `plan-v2.md` into `control/approved-plan.md`.
- Round 2 item 3: `container/skills/discord-review/SKILL.md` is still wrong.

## Prometheus Reference Check

Searched for remaining `Prometheus` references outside `docs/plans/` and `agents/archive/`.

Findings:

- No remaining `Prometheus` references were found in the active docs/skills targeted by Part A (`docs/`, `container/skills/`, `multi-agent-file-first-workflow.md`).
- One repo-root analysis artifact still contains `Prometheus`: `codex-discord-workflow-analysis.md:226`.
- One non-doc workspace artifact also contains it: `groups/shared_project/active/stock/active/stock/control/plan-v2.md:77`.

## Bottom Line

- Fully done: A1, A3, A4, B1, B2.
- Partially done: A2, A5, A6, B3.
- Still broken: A7.
- Additional live issues outside the original plan: `!decompose` can still ignore finalized `plan-v2.md`, and `npm test` currently fails with 2 tests.
