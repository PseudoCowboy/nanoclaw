/**
 * Shared types for NanoClaw agent bots.
 */

export interface AgentConfig {
  name: string;
  folder: string;
  role: string;
  preferredTool: 'claude' | 'codex' | 'gemini';
  tokenEnvVar: string;
  channelNames: string[];
  triggerNames: string[];
  listenToBots: boolean | 'iris-only';
  emoji: string;
  color: number;
}

export interface AgentBotConfig {
  sharedProjectDir: string;
  agents: AgentConfig[];
}

export interface AgentBotOpts {
  name: string;
  tokenEnvVar: string;
  groupFolder: string;
  channelNames: string[];
  triggerNames: string[];
  listenToBots: boolean | 'iris-only';
  emoji: string;
  color: number;
  role: string;
  sharedProjectDir: string;
}
