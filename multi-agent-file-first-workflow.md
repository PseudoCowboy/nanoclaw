# Multi-Agent File-First Hybrid Workflow Implementation Plan

## Summary

Implementation of an enhanced multi-agent orchestration system featuring:
- **File-First Coordination**: Shared workspace with structured file protocols
- **Dynamic Channel Orchestration**: Iris creates channels on-demand based on plan decomposition
- **Human-Guided Planning**: Control room → draft plan → plan room → parallel execution
- **Cross-Team Integration**: Structured handoffs and dependency management

## Requirements

**Core Workflow Requirements:**
- [x] Control room human-AI collaboration interface
- [x] Plan room 4-step workflow (Hermes → Athena → Hermes)
- [x] Plan decomposition via `!decompose` — keyword-based auto-detection with explicit overrides
- [x] Dynamic channel creation by Iris based on decomposed plans
- [x] File-based agent coordination protocols — task-state.json drives execution
- [x] Workstream execution with review gate (implement → review → approve/changes_requested)
- [ ] Cross-team dependency tracking and notifications — `!handoff` and `!blocker` write files, but no automatic tracking/resolution
- [ ] Integration checkpoint system for parallel work streams — placeholder text only, no verification code
- [x] Channel lifecycle management (creation via !create_project/!decompose, cleanup via !cleanup_server)

**Technical Requirements:**
- [x] Shared workspace file structure and access protocols
- [x] Per-agent worktree isolation (container-runner creates worktrees when projectSlug + branchName are set)
- [x] Iris orchestration logic for channel management
- [x] Stream watcher monitoring (hourly status, silence detection, restart recovery)
- [ ] Cross-room status synchronization system — `!dashboard`/`!stream_status` read files on demand; no auto-sync
- [ ] Integration points detection and handoff automation — `!handoff` is manual; no auto-detection
- [ ] Progress tracking via file commits and Git integration — agents commit; no automated commit tracking

## Architecture

### Enhanced Workflow Stages

```
1. Control Room (Human + Athena/Argus)
   ├── !create_project Name — workspace + core channels
   ├── Human writes draft-plan.md in control/ folder
   └── Requirements clarification

2. Plan Room (4-Step Workflow)
   ├── !plan topic — Iris saves plan.md, Hermes reviews, Athena refines
   ├── 4 steps: Human Input → Hermes Reviews → Athena Architects → Hermes Finalizes
   └── Approved plan written to plan-v2.md in shared folder

3. Plan Decomposition & Channel Creation
   ├── !decompose backend frontend qa — Iris analyzes plan
   ├── Creates workstream/ folders with scope, progress, handoffs
   └── Creates #ws-* Discord channels, notifies lead agents

4. Parallel Execution
   ├── #ws-backend: Atlas reads scope.md, updates progress.md
   ├── #ws-frontend: Apollo reads scope.md, updates progress.md
   ├── #ws-qa: Argus reads criteria, validates work
   └── Cross-room coordination via handoffs.md + !handoff command

5. Integration & Completion
   ├── !handoff from to "description" — cross-team integration
   ├── !blocker "issue" — escalates to #control-room
   └── !dashboard / !stream_status — real-time from files
```

### File-First Coordination Structure

```
groups/shared_project/active/{project-slug}/
├── control/
│   ├── draft-plan.md (written by human)
│   └── decomposition.md (work stream breakdown)
├── coordination/
│   ├── progress.md (auto-updated status)
│   ├── integration-points.md (cross-team handoffs)
│   ├── dependencies.md (blocking relationships)
│   └── status-board.md (real-time dashboard)
├── workstreams/
│   ├── backend/
│   │   ├── scope.md (Atlas deliverables)
│   │   ├── progress.md (Atlas updates)
│   │   └── handoffs.md (integration points)
│   ├── frontend/
│   │   ├── scope.md (Apollo deliverables)
│   │   ├── progress.md (Apollo updates)
│   │   └── handoffs.md (UI-API integration)
│   └── qa/
│       ├── scope.md (Argus test requirements)
│       ├── progress.md (testing status)
│       └── handoffs.md (validation results)
└── archive/ (completed work, decisions, lessons learned)
```

### Discord Channel Structure (per project)

```
[ProjectName] (category)
├── #control-room — Human + Athena + Argus | Oversight, decisions
├── #plan-room — Athena + Hermes + Human | Planning sessions
├── #release-log — Human + Argus | Deliveries, sign-offs
├── #ws-backend — Atlas + Argus | Backend work (created by !decompose)
├── #ws-frontend — Apollo + Argus | Frontend work (created by !decompose)
├── #ws-qa — Argus | Testing (created by !decompose)
└── (additional streams created on demand via !add_stream)
```

## Discord Commands

### Project Setup
| Command | Description |
|---------|-------------|
| `!create_project Name` | Creates file workspace + category + core channels |
| `!cleanup_server` | Removes all orchestration structures |

### Planning (use in #plan-room)
| Command | Description |
|---------|-------------|
| `!plan topic` | Start 4-step planning session |
| `!plans` | Show all tracked plans with lifecycle status |
| `!decompose [types]` | Break plan into work stream channels |

### Work Streams
| Command | Description |
|---------|-------------|
| `!add_stream type` | Add a work stream (backend, frontend, qa, design, devops, research) |
| `!handoff from to "desc"` | Create cross-team handoff, notifies target stream |
| `!stream_status` | Read progress from workstream files |

### Monitoring
| Command | Description |
|---------|-------------|
| `!agent_status` | Live agent process status |
| `!logs <agent>` | Recent agent log output |
| `!dashboard` | Project dashboard from coordination files |
| `!blocker "issue"` | Escalate to #control-room |
| `!checkpoint from to` | Verify handoff completeness between streams |
| `!checkpoints` | List all checkpoints and status |

### Discussions (ad-hoc, independent of projects)
| Command | Description |
|---------|-------------|
| `!create_discussion "topic"` | File-based 4-step discussion |
| `!close_discussion` | Delete discussion channel |

### Info
| Command | Description |
|---------|-------------|
| `!help` | Show all commands |
| `!help_orchestration` | Full workflow guide |

## Agent Roles

| Agent | Role | Tool | Work Streams |
|-------|------|------|-------------|
| Athena | Plan Designer | Codex | Planning, Design |
| Hermes | Strategy & Analysis | Claude | Planning |
| Atlas | Backend Engineer | Claude | Backend, DevOps |
| Apollo | Frontend Engineer | Gemini | Frontend, Design |
| Argus | Monitor & Validator | Claude | QA, all streams |

## Work Stream Types

| Type | Channel | Lead Agent | Description |
|------|---------|-----------|-------------|
| backend | #ws-backend | Atlas | Backend implementation |
| frontend | #ws-frontend | Apollo | Frontend implementation |
| qa | #ws-qa | Argus | Quality assurance |
| design | #ws-design | Apollo + Athena | Design and UX |
| devops | #ws-devops | Atlas | Infrastructure |
| research | #ws-research | Athena | Exploration |

## Testing & Validation

**File Protocol Testing:**
- [x] Agent file reading consistency across all agents — scaffolding consistent, no runtime verification
- [ ] File change detection and notification reliability — not implemented
- [ ] Cross-agent file update coordination — not implemented
- [ ] Conflict resolution for simultaneous file access — not implemented

**Workflow Integration Testing:**
- [x] Control room to plan room handoff completeness
- [ ] Plan decomposition accuracy for various project types — arg-based only, no plan parsing
- [x] Dynamic channel creation with correct agent assignments
- [ ] Cross-work stream dependency notification timing — manual only
- [ ] Integration checkpoint validation effectiveness — not implemented

**Performance Testing:**
- [ ] Concurrent work stream execution efficiency
- [ ] File system performance with multiple agent access
- [ ] Channel creation speed and resource utilization
- [ ] Status synchronization latency across teams
- [ ] Scalability with increasing number of parallel projects

**Error Handling Testing:**
- [ ] Agent unavailability fallback mechanisms
- [ ] File system failure recovery procedures
- [ ] Channel creation failure handling
- [ ] Dependency blocking escalation workflows
- [ ] Integration checkpoint failure resolution
