import type { WorkStream } from './types.js';

export const PLANNING_AGENTS = ['Hermes', 'Athena'];
export const DISCUSSION_CHAIN = ['Hermes', 'Athena'];
export const AGENT_HANDOFF_TIMEOUT = 300_000; // 5 minutes
export const HUMAN_INPUT_TIMEOUT = 600_000; // 10 minutes for human to paste plan content

// Stream watcher timing
export const STREAM_POLL_INTERVAL = 600_000; // 10 minutes
export const STREAM_SILENCE_THRESHOLD = 3_600_000; // 1 hour
export const STREAM_STATUS_INTERVAL = 3_600_000; // 1 hour
export const HERMES_DECOMPOSE_TIMEOUT = 300_000; // 5 minutes

// File lock timing
export const LOCK_STALE_MS = 30_000;

// Workspace watcher timing
export const WORKSPACE_POLL_INTERVAL = 30_000;

export const AGENTS = [
  { name: 'Athena', role: 'Plan Designer', tool: 'codex', color: '\u{1F7E3}' },
  {
    name: 'Hermes',
    role: 'Planning Collaborator',
    tool: 'claude',
    color: '\u{1F7E2}',
  },
  {
    name: 'Atlas',
    role: 'Backend Engineer',
    tool: 'claude',
    color: '\u{1F534}',
  },
  {
    name: 'Apollo',
    role: 'Frontend Engineer',
    tool: 'gemini',
    color: '\u{1F535}',
  },
  { name: 'Argus', role: 'Monitor', tool: 'claude', color: '\u{1F7E0}' },
];

export const AGENT_COLORS: Record<string, number> = {
  Athena: 0x9b59b6,
  Hermes: 0x2ecc71,
  Atlas: 0xe74c3c,
  Apollo: 0x3498db,
  Argus: 0xf39c12,
};

// Workstream type definitions — used by Iris to decompose plans into channels
export const WORKSTREAM_DEFS: Record<string, WorkStream> = {
  backend: {
    type: 'backend',
    channel: 'ws-backend',
    agents: ['Atlas', 'Argus'],
    emoji: '\u{2699}\u{FE0F}',
    topic: 'Backend implementation — Atlas leads, Argus monitors',
  },
  frontend: {
    type: 'frontend',
    channel: 'ws-frontend',
    agents: ['Apollo', 'Argus'],
    emoji: '\u{1F3A8}',
    topic: 'Frontend implementation — Apollo leads, Argus monitors',
  },
  qa: {
    type: 'qa',
    channel: 'ws-qa',
    agents: ['Argus'],
    emoji: '\u{1F9EA}',
    topic: 'Quality assurance and validation — Argus leads',
  },
  design: {
    type: 'design',
    channel: 'ws-design',
    agents: ['Apollo', 'Athena'],
    emoji: '\u{1F58C}\u{FE0F}',
    topic: 'Design and UX — Apollo and Athena collaborate',
  },
  devops: {
    type: 'devops',
    channel: 'ws-devops',
    agents: ['Atlas', 'Argus'],
    emoji: '\u{1F6E0}\u{FE0F}',
    topic: 'Infrastructure and deployment — Atlas leads',
  },
  research: {
    type: 'research',
    channel: 'ws-research',
    agents: ['Athena', 'Hermes'],
    emoji: '\u{1F50D}',
    topic: 'Research and exploration — Athena leads',
  },
};

// Core project channels (always created)
export const CORE_CHANNELS = [
  {
    name: 'control-room',
    topic: '\u{1F3AF} Human + Athena + Argus | Oversight, decisions, approvals',
    emoji: '\u{1F3AF}',
  },
  {
    name: 'plan-room',
    topic: '\u{1F5E3}\u{FE0F} Athena + Hermes + Human | Planning sessions',
    emoji: '\u{1F4A1}',
  },
  {
    name: 'release-log',
    topic: '\u{1F4E6} Human + Argus | Deliveries, summaries, sign-offs',
    emoji: '\u{1F680}',
  },
];
