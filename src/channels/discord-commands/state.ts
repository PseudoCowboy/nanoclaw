import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import type {
  PlanningSession,
  DiscussionSession,
  ProjectState,
  StreamWatcherState,
  WatcherState,
} from './types.js';

// --- Register group callback ---

let onRegisterGroup:
  | ((jid: string, name: string, folder: string, trigger: string) => void)
  | null = null;

export function setRegisterGroupCallback(
  cb: (jid: string, name: string, folder: string, trigger: string) => void,
): void {
  onRegisterGroup = cb;
}

export function getRegisterGroupCallback() {
  return onRegisterGroup;
}

// --- Channel → project slug mapping ---

const CHANNEL_PROJECT_MAP_PATH = path.resolve(
  process.cwd(),
  'store',
  'channel-project-map.json',
);
export const channelProjectMap = new Map<string, string>();

// Load on module init
try {
  if (fs.existsSync(CHANNEL_PROJECT_MAP_PATH)) {
    const data = JSON.parse(fs.readFileSync(CHANNEL_PROJECT_MAP_PATH, 'utf8'));
    for (const [channelId, slug] of Object.entries(data)) {
      channelProjectMap.set(channelId, slug as string);
    }
    logger.info(
      { count: channelProjectMap.size },
      'Loaded channel-project-map',
    );
  }
} catch (err) {
  logger.warn({ err }, 'Failed to load channel-project-map');
}

export function saveChannelProjectMap(): void {
  try {
    const data = Object.fromEntries(channelProjectMap);
    fs.mkdirSync(path.dirname(CHANNEL_PROJECT_MAP_PATH), { recursive: true });
    fs.writeFileSync(
      CHANNEL_PROJECT_MAP_PATH,
      JSON.stringify(data, null, 2) + '\n',
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to save channel-project-map');
  }
}

export function getProjectSlugForChannel(channelId: string): string | null {
  return channelProjectMap.get(channelId) || null;
}

export function setChannelProjectSlug(
  channelId: string,
  projectSlug: string,
): void {
  channelProjectMap.set(channelId, projectSlug);
  saveChannelProjectMap();
}

// --- Session and project state maps ---

export const planningSessions = new Map<string, PlanningSession>();
export const discussionListeners = new Map<
  string,
  { listener: (...args: any[]) => void; timer: ReturnType<typeof setTimeout> }
>();

export const discussionSessions = new Map<string, DiscussionSession>();
export const activeProjects = new Map<string, ProjectState>();
export const activeStreamWatchers = new Map<string, StreamWatcherState>();
export const activeWatchers = new Map<string, WatcherState>();

// --- Channel → agent branch mapping (for workstream isolation) ---
export const channelBranchMap = new Map<string, string>(); // channelId → branchName
