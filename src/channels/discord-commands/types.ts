import { Client, Message } from 'discord.js';

export interface PlanningSession {
  topic: string;
  featureId: string | null;
  round: number;
}

export interface DiscussionSession {
  topic: string;
  slug: string;
  round: number; // 0 = not started, 1-4 = step number
  currentAgent: string | null;
  channelId: string;
  /** When !plan runs from control-room, this stores the control-room channel ID
   *  so the completion handler can clean up both channels' session entries. */
  sourceChannelId?: string;
}

export interface WorkStream {
  type:
    | 'backend'
    | 'frontend'
    | 'qa'
    | 'design'
    | 'devops'
    | 'research'
    | 'general';
  channel: string;
  agents: string[];
  emoji: string;
  topic: string;
}

export interface StreamWatcherState {
  interval: ReturnType<typeof setInterval>;
  listener: (...args: any[]) => void;
  projectSlug: string;
  streamType: string;
  channelId: string;
  categoryId: string;
  lastActivityTime: number;
  lastStatusReport: number;
  lastTasksMtime: number;
  completed: boolean;
  lastReviewedTaskId?: number;
  taskStateInitialized: boolean;
  currentBranch?: string;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'implemented'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'merge_conflict';

export interface TaskStateEntry {
  id: number;
  status: TaskStatus;
  reviewRounds: number;
  lastCommit?: string;
}

export interface TaskState {
  tasks: TaskStateEntry[];
  currentTask: number | null;
  lastReviewedBy: string | null;
}

export interface ProjectState {
  name: string;
  categoryId: string;
  workStreams: Map<string, WorkStream>;
  controlRoomId: string;
  planRoomId: string;
}

export type CommandHandler = (
  message: Message,
  client: Client,
) => Promise<void>;

export interface LockInfo {
  pid: number;
  timestamp: number;
}

export interface WatcherState {
  interval: ReturnType<typeof setInterval>;
  mtimes: Map<string, number>;
}
