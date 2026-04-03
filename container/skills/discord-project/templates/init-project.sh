#!/bin/bash
# Init a project for an agent: clone, scaffold if empty, set git identity, create worktree
# Usage: bash init-project.sh <repo-url> <agent-name>
# Example: bash init-project.sh git@github.com:owner/my-app.git athena
#
# First agent to run this on an empty repo will scaffold the project structure,
# commit, and push. Subsequent agents will clone the scaffolded repo and create
# their own worktree.

set -e

REPO_URL="$1"
AGENT_NAME="$2"
SHARED="/workspace/shared/projects"
TEMPLATES="/home/node/.claude/skills/discord-project/templates"

# Extract project name from repo URL (e.g. git@github.com:owner/my-app.git -> my-app)
PROJECT_NAME=$(basename "$REPO_URL" .git)

MAIN_DIR="$SHARED/$PROJECT_NAME"
WORKTREE_DIR="$SHARED/${PROJECT_NAME}-${AGENT_NAME}"
BRANCH="${AGENT_NAME}/${PROJECT_NAME}"

if [ -z "$REPO_URL" ] || [ -z "$AGENT_NAME" ]; then
  echo "Usage: bash init-project.sh <repo-url> <agent-name>"
  echo "Example: bash init-project.sh git@github.com:owner/my-app.git athena"
  exit 1
fi

# Capitalize first letter for display name
DISPLAY_NAME="$(echo "${AGENT_NAME:0:1}" | tr '[:lower:]' '[:upper:]')${AGENT_NAME:1}"

# ── Step 1: Clone if not already cloned ──────────────────────────────────────

if [ ! -d "$MAIN_DIR/.git" ]; then
  echo "==> Cloning $REPO_URL"
  mkdir -p "$SHARED"
  git clone "$REPO_URL" "$MAIN_DIR"
fi

cd "$MAIN_DIR"

# Set git identity on main repo too (for scaffold commit)
git config user.name "$DISPLAY_NAME"
git config user.email "${AGENT_NAME}@nanoclaw"

# ── Step 2: Scaffold if empty repo ───────────────────────────────────────────

# Detect empty repo: no commits yet
if ! git rev-parse HEAD &>/dev/null; then
  echo "==> Empty repo detected — scaffolding project"

  # Create directory structure
  mkdir -p src/{api,services,models,utils} tests/{api,services,models} docs plans reviews

  # Copy templates
  [ -f "$TEMPLATES/ARCHITECTURE.md" ] && cp "$TEMPLATES/ARCHITECTURE.md" . && sed -i "s/\[Project Name\]/$PROJECT_NAME/g" ARCHITECTURE.md
  [ -f "$TEMPLATES/GOLDEN-PRINCIPLES.md" ] && cp "$TEMPLATES/GOLDEN-PRINCIPLES.md" .
  [ -f "$TEMPLATES/lint-architecture.sh" ] && cp "$TEMPLATES/lint-architecture.sh" . && chmod +x lint-architecture.sh
  [ -f "$TEMPLATES/test-structure.sh" ] && cp "$TEMPLATES/test-structure.sh" . && chmod +x test-structure.sh
  [ -f "$TEMPLATES/generate-plan-index.sh" ] && cp "$TEMPLATES/generate-plan-index.sh" . && chmod +x generate-plan-index.sh
  [ -f "$TEMPLATES/plan-template.md" ] && cp "$TEMPLATES/plan-template.md" plans/

  # Copy this script into the repo so other agents can use it
  cp "$TEMPLATES/init-project.sh" . && chmod +x init-project.sh

  # Create README
  cat > README.md << READMEEOF
# $PROJECT_NAME

## Overview
[Description - fill this in]

## Structure
- \`src/\` - Source code (api/, services/, models/, utils/)
- \`tests/\` - Test files (mirrors src/ structure)
- \`docs/\` - Documentation
- \`plans/\` - Feature plans
- \`reviews/\` - Code review records

## Getting Started
\`\`\`bash
bash init-project.sh $REPO_URL your-agent-name
\`\`\`

## Agents
| Agent | Role | Worktree |
|-------|------|----------|
| **Athena** | Plans features, writes docs | \`${PROJECT_NAME}-athena/\` |
| **Hermes** | Collaborates on plans, refactors | \`${PROJECT_NAME}-hermes/\` |
| **Atlas** | Backend implementation | \`${PROJECT_NAME}-atlas/\` |
| **Apollo** | Frontend implementation | \`${PROJECT_NAME}-apollo/\` |
| **Argus** | Reviews PRs, enforces standards | \`${PROJECT_NAME}-argus/\` |

## PR Workflow
1. Work in your worktree
2. \`git add . && git commit -m "description"\`
3. \`git push origin your-name/$PROJECT_NAME\`
4. \`gh pr create --base main --head your-name/$PROJECT_NAME\`
5. @Argus reviews -> merge
6. \`git pull origin main\` (sync after merge)
READMEEOF

  # Add .gitkeep to empty dirs so git tracks them
  for dir in src/api src/services src/models src/utils tests/api tests/services tests/models docs reviews; do
    [ -z "$(ls -A "$dir" 2>/dev/null)" ] && touch "$dir/.gitkeep"
  done

  # Initial commit and push
  git add .
  git commit -m "Initial project scaffold with templates and tooling"
  git push -u origin main

  echo "==> Scaffold committed and pushed to main"
fi

# ── Step 3: Copy templates that might be missing (existing repo) ─────────────

# If repo already had commits but is missing templates, add them
if [ ! -f lint-architecture.sh ] && [ -f "$TEMPLATES/lint-architecture.sh" ]; then
  echo "==> Adding missing templates to existing repo"
  [ ! -f ARCHITECTURE.md ] && [ -f "$TEMPLATES/ARCHITECTURE.md" ] && cp "$TEMPLATES/ARCHITECTURE.md" . && sed -i "s/\[Project Name\]/$PROJECT_NAME/g" ARCHITECTURE.md
  [ ! -f GOLDEN-PRINCIPLES.md ] && [ -f "$TEMPLATES/GOLDEN-PRINCIPLES.md" ] && cp "$TEMPLATES/GOLDEN-PRINCIPLES.md" .
  [ ! -f lint-architecture.sh ] && cp "$TEMPLATES/lint-architecture.sh" . && chmod +x lint-architecture.sh
  [ ! -f test-structure.sh ] && [ -f "$TEMPLATES/test-structure.sh" ] && cp "$TEMPLATES/test-structure.sh" . && chmod +x test-structure.sh
  [ ! -f generate-plan-index.sh ] && [ -f "$TEMPLATES/generate-plan-index.sh" ] && cp "$TEMPLATES/generate-plan-index.sh" . && chmod +x generate-plan-index.sh
  [ ! -f init-project.sh ] && cp "$TEMPLATES/init-project.sh" . && chmod +x init-project.sh
  mkdir -p plans reviews
  [ ! -f plans/plan-template.md ] && [ -f "$TEMPLATES/plan-template.md" ] && cp "$TEMPLATES/plan-template.md" plans/

  if [ -n "$(git status --porcelain)" ]; then
    git add .
    git commit -m "Add project tooling templates"
    git push
    echo "==> Templates committed and pushed"
  fi
fi

# ── Step 4: Install pre-commit hook ──────────────────────────────────────────

if [ -f "$TEMPLATES/pre-commit" ]; then
  mkdir -p .git/hooks
  cp "$TEMPLATES/pre-commit" .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  echo "==> Pre-commit hook installed"
fi

# ── Step 5: Create worktree ──────────────────────────────────────────────────

if [ -d "$WORKTREE_DIR" ]; then
  echo ""
  echo "Worktree already exists at $WORKTREE_DIR"
  cd "$WORKTREE_DIR"
  git config user.name "$DISPLAY_NAME"
  git config user.email "${AGENT_NAME}@nanoclaw"
  echo "   Git identity: $DISPLAY_NAME <${AGENT_NAME}@nanoclaw>"
  echo "   To sync: git pull origin main"
  exit 0
fi

cd "$MAIN_DIR"

# Create branch from main if it doesn't exist
if ! git branch --list "$BRANCH" | grep -q "$BRANCH"; then
  git branch "$BRANCH" main
  echo "==> Created branch: $BRANCH"
fi

# Create the worktree
git worktree add "$WORKTREE_DIR" "$BRANCH"

# ── Step 6: Set git identity in worktree ─────────────────────────────────────

cd "$WORKTREE_DIR"
git config user.name "$DISPLAY_NAME"
git config user.email "${AGENT_NAME}@nanoclaw"

# Install pre-commit hook in worktree too
if [ -f "$TEMPLATES/pre-commit" ]; then
  # Worktrees share .git with main, but hooks dir might differ
  HOOKS_DIR=$(git rev-parse --git-dir)/hooks
  mkdir -p "$HOOKS_DIR"
  cp "$TEMPLATES/pre-commit" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
fi

echo ""
echo "============================================"
echo " Project initialized for $DISPLAY_NAME"
echo "============================================"
echo "   Worktree: $WORKTREE_DIR"
echo "   Branch:   $BRANCH"
echo "   Git user: $DISPLAY_NAME <${AGENT_NAME}@nanoclaw>"
echo ""
echo "Workflow:"
echo "  1. cd $WORKTREE_DIR"
echo "  2. git add . && git commit -m 'description'"
echo "  3. git push origin $BRANCH"
echo "  4. gh pr create --base main --head $BRANCH"
echo "  5. @Argus reviews -> merge"
echo "  6. git pull origin main"
