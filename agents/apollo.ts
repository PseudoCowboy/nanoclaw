import { createAgentBot } from './shared/agent-runner.js';
import config from './config.json' with { type: 'json' };
import type { AgentBotConfig } from './shared/types.js';

const cfg = config as AgentBotConfig;
const agent = cfg.agents.find((a) => a.name === 'Apollo');
if (!agent) throw new Error('Apollo not found in config');

createAgentBot({
  ...agent,
  groupFolder: agent.folder,
  sharedProjectDir: cfg.sharedProjectDir,
});
