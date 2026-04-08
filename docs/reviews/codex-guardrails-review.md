# Guardrails Review

## Findings

1. High: `!doctor_workflow` cannot distinguish orphaned sessions from sessions that belong to a different guild, because the persisted session records do not store any guild identifier and the command checks existence only against `message.guild.channels.cache`. In a multi-server deployment, running the command in server A will report valid planning/discussion sessions from server B as orphaned. It can also false-positive on uncached channels. References: `src/channels/discord-commands/doctor.ts:38`, `src/channels/discord-commands/doctor.ts:77`, `src/channels/discord-commands/doctor.ts:93`, `src/channels/discord-commands/stream-watcher.ts:200`, `src/channels/discord-commands/stream-watcher.ts:214`.

2. High: `scripts/verify-workflow-manifest.sh` presents itself as a canonical manifest check, but it never compares docs against the extracted agent list or workstream type list. `AGENTS_SOURCE` and `STREAMS_SOURCE` are only printed, while drift detection is hardcoded to four removed agent names plus a single command-count check. A future agent rename/addition or workstream-type drift will still pass. References: `scripts/verify-workflow-manifest.sh:17`, `scripts/verify-workflow-manifest.sh:23`, `scripts/verify-workflow-manifest.sh:39`, `scripts/verify-workflow-manifest.sh:56`.

3. Medium: `scanWorkflowDrift()` does not match the live workflow thresholds or states. The stream watcher escalates to humans at `reviewRounds >= 3`, but the maintenance scan only warns when a task is still `in_review` and `reviewRounds > 5`. That misses the actual stuck states that matter most, including tasks already cycling through `changes_requested` or sitting at 3-5 review rounds. References: `src/maintenance.ts:133`, `src/maintenance.ts:146`, `src/channels/discord-commands/stream-watcher.ts:823`, `src/channels/discord-commands/stream-watcher.ts:843`.

4. Medium: the invariant wiring is incomplete relative to the new invariant module and tests. `workflow-invariants.ts` and its tests define `approved -> merge_conflict` and `merge_conflict -> approved` as valid transitions, but the actual `approved -> merge_conflict` mutation in the watcher is not guarded by `assertValidTaskTransition`, and the manual recovery path back to `approved` has no runtime enforcement at all. The test suite therefore overstates what production code is actually checking. References: `src/channels/discord-commands/workflow-invariants.ts:14`, `src/channels/discord-commands/workflow-invariants.ts:15`, `src/channels/discord-commands/workflow-invariants.test.ts:75`, `src/channels/discord-commands/workflow-invariants.test.ts:81`, `src/channels/discord-commands/stream-watcher.ts:757`.

5. Medium: `scripts/lint-plan-frontmatter.sh` does not verify that the closing `---` delimiter exists. `sed -n '2,/^---$/p' | sed '$d'` will consume the rest of the file if the second delimiter is missing, so a malformed document can still pass as long as `status:` and `date:` appear somewhere in the captured text. References: `scripts/lint-plan-frontmatter.sh:39`, `scripts/lint-plan-frontmatter.sh:48`, `scripts/lint-plan-frontmatter.sh:49`.

6. Medium: the new `!doctor_workflow` command is registered and documented in `docs/discord-bot-summary.md`, but it is missing from the runtime `!help` embed. That leaves the command undiscoverable from the bot itself and makes the command surface inconsistent depending on which help path a user follows. References: `src/channels/discord-commands/index.ts:172`, `src/channels/discord-commands/help.ts:40`, `src/channels/discord-commands/help.ts:46`, `docs/discord-bot-summary.md:109`.

7. Low: `checkInvariant()` is documented as a soft-check that logs invariant failures, but it neither logs nor uses its `name` parameter. Right now it is only a thin try/catch wrapper returning `{ ok, error }`, so the module's advertised observability behavior is missing. References: `src/channels/discord-commands/workflow-invariants.ts:70`, `src/channels/discord-commands/workflow-invariants.ts:74`, `src/channels/discord-commands/workflow-invariants.ts:81`.

8. Low: the new front matter introduces lifecycle metadata that disagrees with the human-readable status already present in several plan documents. Example: front matter says `completed` or `superseded`, while the body still says `**Status:** Approved` / `Approved design`. If other tooling or humans read the body instead of the YAML, they will get a different lifecycle answer. References: `docs/plans/2026-03-11-financial-data-collection-design.md:2`, `docs/plans/2026-03-11-financial-data-collection-design.md:9`, `docs/plans/vm-auth-bridge-design.md:2`, `docs/plans/vm-auth-bridge-design.md:11`.

## Validation

- `npx vitest run src/channels/discord-commands/workflow-invariants.test.ts src/maintenance.test.ts` passed.
- `npx tsc --noEmit` passed.
- `bash scripts/lint-plan-frontmatter.sh` passed.
- `bash scripts/verify-workflow-manifest.sh` passed, which is part of the problem described above: the script passes despite leaving several drift classes unchecked.
