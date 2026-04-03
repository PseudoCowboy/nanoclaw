import { TextChannel } from 'discord.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger.js';
import { activeProjects } from './state.js';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90)
    .replace(/^-+|-+$/g, '');
}

/**
 * Count checked and total tasks in a markdown checklist.
 * Matches lines like `- [x] ...` and `- [ ] ...`.
 */
export function countTasks(content: string): { done: number; total: number } {
  const all = content.match(/^- \[[ x]\] /gm) || [];
  const checked = content.match(/^- \[x\] /gm) || [];
  return { done: checked.length, total: all.length };
}

/**
 * Find the project slug for a channel by looking at its category name.
 */
export function findProjectSlugForChannel(channel: TextChannel): string | null {
  if (!channel.parent) return null;
  const categoryName = channel.parent.name;
  for (const [slug, project] of activeProjects) {
    if (project.name === categoryName) return slug;
  }
  // Fall back to slugifying the category name
  return slugify(categoryName);
}

/**
 * Create the discussion folder and git init it.
 * If projectSlug is provided, creates INSIDE the project directory so agents
 * with project-scoped mounts can access it. Otherwise creates at top-level
 * under groups/shared_project/.
 * Returns the host path to the folder.
 */
export function initDiscussionFolder(
  slug: string,
  projectSlug?: string,
): string {
  let discussDir: string;
  if (projectSlug) {
    // Inside project → visible to agents as /workspace/shared/plans/<slug>/
    discussDir = path.resolve(
      process.cwd(),
      'groups',
      'shared_project',
      'active',
      projectSlug,
      'plans',
      slug,
    );
  } else {
    // Top-level — for standalone discussions not tied to a project
    const sharedDir = path.resolve(process.cwd(), 'groups', 'shared_project');
    discussDir = path.join(sharedDir, slug);
  }

  if (fs.existsSync(discussDir)) {
    logger.info({ discussDir }, 'Discussion folder already exists');
    return discussDir;
  }

  fs.mkdirSync(discussDir, { recursive: true });

  try {
    execSync('git init -b main', {
      cwd: discussDir,
      encoding: 'utf8',
      timeout: 10000,
    });
    execSync('git config user.name "Discussion"', {
      cwd: discussDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    execSync('git config user.email "discussion@nanoclaw"', {
      cwd: discussDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    logger.info({ discussDir }, 'Initialized discussion git repo');
  } catch (err: any) {
    logger.error(
      { err: err.message, discussDir },
      'Failed to git init discussion folder',
    );
  }

  return discussDir;
}

/**
 * Initialize the file-first workspace for a project.
 * Creates the shared folder structure with control/, coordination/, workstreams/, and archive/.
 */
export function initProjectWorkspace(projectSlug: string): string {
  const baseDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
  );

  if (fs.existsSync(baseDir)) {
    logger.info({ baseDir }, 'Project workspace already exists');
    return baseDir;
  }

  const dirs = ['control', 'coordination', 'workstreams', 'archive'];

  for (const dir of dirs) {
    fs.mkdirSync(path.join(baseDir, dir), { recursive: true });
  }

  // Initialize coordination files
  const coordFiles: Record<string, string> = {
    'coordination/progress.md':
      `# Progress Dashboard\n\n` +
      `*Auto-updated by agents. Last update: ${new Date().toISOString()}*\n\n` +
      `## Work Streams\n\n| Stream | Status | Agent | Last Update |\n|--------|--------|-------|-------------|\n`,
    'coordination/dependencies.md':
      `# Dependencies\n\n` +
      `## Blocking Relationships\n\n` +
      `| ID | Dependent | Required | Status | Description |\n` +
      `|----|-----------|----------|--------|-------------|\n`,
    'coordination/integration-points.md':
      `# Integration Points\n\n` +
      `Cross-team handoffs and integration checkpoints.\n\n` +
      `## Active Handoffs\n\n*None yet.*\n`,
    'coordination/status-board.md':
      `# Status Board\n\n` +
      `Real-time project dashboard.\n\n` +
      `## Overall Status: Planning\n\n` +
      `### Agents\n\n` +
      `| Agent | Role | Current Task | Status |\n` +
      `|-------|------|-------------|--------|\n` +
      `| Athena | Plan Designer | Awaiting plan | Idle |\n` +
      `| Hermes | Reviewer | Awaiting plan | Idle |\n` +
      `| Atlas | Backend | Awaiting plan | Idle |\n` +
      `| Apollo | Frontend | Awaiting plan | Idle |\n` +
      `| Argus | PR Reviewer | Watching | Active |\n`,
  };

  for (const [relPath, content] of Object.entries(coordFiles)) {
    fs.writeFileSync(path.join(baseDir, relPath), content, 'utf8');
  }

  // Generate lint-check.sh template for mechanical validation
  const lintCheckContent =
    '#!/bin/bash\n' +
    '# Mechanical validation script — run by Argus before semantic review.\n' +
    '# Customize per project: add lint, test, and build commands.\n' +
    '#\n' +
    '# Exit codes: 0 = pass, non-zero = fail\n' +
    '# Keywords in output: LINT_FAILED, TESTS_FAILED, BUILD_FAILED\n' +
    '\n' +
    'set -euo pipefail\n' +
    'cd "$(dirname "$0")"\n' +
    '\n' +
    '# --- Lint ---\n' +
    '# Uncomment and adapt for your project:\n' +
    '# npm run lint 2>&1 || { echo "LINT_FAILED"; exit 1; }\n' +
    '\n' +
    '# --- Tests ---\n' +
    '# npm test 2>&1 || { echo "TESTS_FAILED"; exit 1; }\n' +
    '\n' +
    '# --- Build ---\n' +
    '# npm run build 2>&1 || { echo "BUILD_FAILED"; exit 1; }\n' +
    '\n' +
    'echo "All mechanical checks passed."\n';

  fs.writeFileSync(path.join(baseDir, 'lint-check.sh'), lintCheckContent, {
    mode: 0o755,
  });

  // Git init the workspace
  try {
    execSync('git init -b main', {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: 10000,
    });
    execSync('git config user.name "Project"', {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    execSync('git config user.email "project@nanoclaw"', {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    execSync('git add -A && git commit -m "Initialize project workspace"', {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: 10000,
      shell: '/bin/bash',
    });
    logger.info({ baseDir }, 'Initialized project workspace with git');
  } catch (err: any) {
    logger.error(
      { err: err.message, baseDir },
      'Failed to git init project workspace',
    );
  }

  return baseDir;
}

/**
 * Create a workstream folder within a project workspace.
 */
export function initWorkstreamFolder(
  projectSlug: string,
  workstreamName: string,
  agents: string[],
  deliverables: string[],
): string {
  const wsDir = path.resolve(
    process.cwd(),
    'groups',
    'shared_project',
    'active',
    projectSlug,
    'workstreams',
    workstreamName,
  );

  if (fs.existsSync(wsDir)) return wsDir;

  fs.mkdirSync(wsDir, { recursive: true });

  const scopeContent =
    `# ${workstreamName} Work Stream\n\n` +
    `## Assigned Agents\n${agents.map((a) => `- ${a}`).join('\n')}\n\n` +
    `## Deliverables\n${deliverables.map((d) => `- [ ] ${d}`).join('\n')}\n\n` +
    `## Scope\n\n*To be filled by assigned agent.*\n`;

  const progressContent =
    `# ${workstreamName} Progress\n\n` +
    `*Updated by agents after each work session.*\n\n` +
    `## Completed\n\n*None yet.*\n\n` +
    `## In Progress\n\n*None yet.*\n\n` +
    `## Blocked\n\n*None.*\n`;

  const handoffsContent =
    `# ${workstreamName} Handoffs\n\n` +
    `Integration points with other work streams.\n\n` +
    `## Outgoing (this stream provides)\n\n*None defined yet.*\n\n` +
    `## Incoming (this stream needs)\n\n*None defined yet.*\n`;

  fs.writeFileSync(path.join(wsDir, 'scope.md'), scopeContent, 'utf8');
  fs.writeFileSync(path.join(wsDir, 'progress.md'), progressContent, 'utf8');
  fs.writeFileSync(path.join(wsDir, 'handoffs.md'), handoffsContent, 'utf8');

  return wsDir;
}

/**
 * Parse handoff statuses from a handoffs.md file.
 * Returns array of { description, target, status }.
 */
export function parseHandoffs(
  handoffsContent: string,
  section: 'Outgoing' | 'Incoming',
): Array<{ description: string; target: string; status: string }> {
  const results: Array<{
    description: string;
    target: string;
    status: string;
  }> = [];
  const sectionHeader =
    section === 'Outgoing'
      ? '## Outgoing (this stream provides)'
      : '## Incoming (this stream needs)';

  const sectionIdx = handoffsContent.indexOf(sectionHeader);
  if (sectionIdx === -1) return results;

  const afterSection = handoffsContent.slice(sectionIdx + sectionHeader.length);
  // Stop at next ## heading or end of file
  const nextSection = afterSection.indexOf('\n## ');
  const sectionContent =
    nextSection >= 0 ? afterSection.slice(0, nextSection) : afterSection;

  const lines = sectionContent
    .split('\n')
    .filter((l) => l.trim().startsWith('- '));
  for (const line of lines) {
    // Format: - description (→ target) [Status]
    const match = line.match(
      /^- (.+?)\s+\([\u2192\u2190]\s+(\w+)\)\s+\[(\w[\w\s]*)\]/,
    );
    if (match) {
      results.push({
        description: match[1],
        target: match[2],
        status: match[3],
      });
    }
  }

  return results;
}
