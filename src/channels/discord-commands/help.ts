import { Client, Message, EmbedBuilder } from 'discord.js';

export async function cmdHelp(
  message: Message,
  _client: Client,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('\u{1F916} Iris Discord Commands')
    .setDescription(
      'File-first multi-agent orchestration. Plans become files, files become channels, channels become code.',
    )
    .addFields(
      {
        name: '\u{1F3D7}\u{FE0F} Project Setup',
        value:
          '`!create_project Name` \u2014 Create project with workspace + core channels\n`!cleanup_server` \u2014 Remove all orchestration structures',
      },
      {
        name: '\u{1F4A1} Planning',
        value:
          '`!plan topic description` \u2014 Start agent-driven planning (Iris saves draft, @Athena + Hermes collaborate)\n`!plans` \u2014 Show all tracked plans with lifecycle status\n`!decompose [streams]` \u2014 Break plan into work stream channels',
      },
      {
        name: '\u{1F4A1} Discussions',
        value:
          '`!create_discussion "topic"` \u2014 File-based discussion with shared folder + git\n`!close_discussion` \u2014 Delete current discussion or planning channel',
      },
      {
        name: '\u{1F527} Work Streams',
        value:
          '`!add_stream type` \u2014 Add a work stream channel (backend, frontend, qa, design, devops, research)\n`!handoff from to "description"` \u2014 Create a cross-team handoff\n`!stream_status` \u2014 Show all work stream progress',
      },
      {
        name: '\u{1F4CA} Monitoring',
        value:
          '`!agent_status` \u2014 Per-agent health dashboard\n`!logs <agent>` \u2014 Recent agent logs\n`!dashboard` \u2014 Project-wide status from coordination files\n`!blocker "description"` \u2014 Escalate a blocker to control-room',
      },
      {
        name: '\u2705 Checkpoints',
        value:
          '`!checkpoint from to` \u2014 Verify handoff completeness between streams\n`!checkpoints` \u2014 List all handoff statuses',
      },
      {
        name: '\u{1F916} Info',
        value: '`!help_orchestration` \u2014 Full workflow guide',
      },
    )
    .setFooter({ text: 'Iris \u2014 NanoClaw Discord Bot' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

export async function cmdHelpOrchestration(
  message: Message,
  _client: Client,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('\u{1F4CB} File-First Agent Orchestration')
    .setDescription('Complete guide to the multi-agent workflow')
    .addFields(
      {
        name: '\u{1F3AF} Workflow Stages',
        value:
          '1. `!create_project` \u2014 Creates workspace + core channels\n' +
          '2. Draft plan in `control/draft-plan.md`\n' +
          '3. `!plan topic` in #plan-room or #control-room \u2014 Iris saves & @Hermes starts 4-step flow\n' +
          '4. Hermes \u2194 Athena refine the plan (agent-driven, no rounds)\n' +
          '5. `!decompose` \u2014 Iris creates work stream channels\n' +
          '6. Agents execute in parallel, reading scope from files\n' +
          '7. `!handoff` for cross-team integration points\n' +
          '8. Human signs off in #control-room',
      },
      {
        name: '\u{1F4C2} File-First Workspace',
        value:
          '```\n' +
          'active/{project}/\n' +
          '\u251C\u2500 control/          (plans, approvals)\n' +
          '\u251C\u2500 coordination/     (progress, deps, status)\n' +
          '\u251C\u2500 workstreams/      (per-stream scope + progress)\n' +
          '\u2514\u2500 archive/          (completed work)\n' +
          '```',
      },
      {
        name: '\u{1F4A1} Ad-hoc Discussions',
        value:
          '`!create_discussion "topic"` \u2014 File-based collaborative discussion\n' +
          '\u2022 Creates shared folder with git repo\n' +
          '\u2022 Paste your draft plan, Iris saves it, then @Hermes starts\n' +
          '\u2022 4 steps: Human input \u2192 Hermes reviews \u2192 Athena architects \u2192 Hermes finalizes\n' +
          '\u2022 Agents: Hermes \u2194 Athena\n' +
          '`!close_discussion` \u2014 Remove when done',
      },
      {
        name: '\u{1F916} Planning Agents (2)',
        value:
          '\u2022 **Hermes** (Claude): Strategy, review & analysis\n\u2022 **Athena** (Codex): Plan design & architecture',
      },
      {
        name: '\u{1F6E0}\u{FE0F} Implementation Agents (2)',
        value:
          '\u2022 **Atlas** (Claude): Backend engineering\n\u2022 **Apollo** (Gemini): Frontend engineering',
      },
      {
        name: '\u{1F441}\u{FE0F} Monitor (1)',
        value: '\u2022 **Argus** (Claude): Validation & alerts',
      },
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}
