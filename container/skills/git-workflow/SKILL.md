---
name: git-workflow
description: Use when working with git repositories — committing, branching, reviewing changes, resolving conflicts, or managing PRs. Ensures safe, clean git practices.
allowed-tools: Bash(git:*)
---

# Git Workflow

Safe, clean git practices for code work.

## Before Any Work

```bash
# Always check current state first
git status
git branch -v
git log --oneline -5
```

## Committing

```bash
# Stage specific files (never blind `git add .`)
git add src/feature.ts src/feature.test.ts

# Write clear commit messages
git commit -m "$(cat <<'EOF'
Add user authentication endpoint

Implements JWT-based auth with refresh tokens.
Includes rate limiting and input validation.
EOF
)"
```

### Commit Message Rules
- First line: imperative mood, under 72 chars ("Add feature" not "Added feature")
- Blank line, then details if needed
- Explain *why*, not *what* (the diff shows what)

## Branching

```bash
# Create feature branch from main
git checkout -b feature/description main

# When done, merge back
git checkout main
git merge feature/description
```

Naming: `feature/`, `fix/`, `refactor/`, `docs/`

## Safe Operations

### Always do
- `git status` before committing
- `git diff` to review changes before staging
- `git log --oneline -5` to understand recent history
- Stage specific files, not `git add -A`
- Commit frequently with small, focused changes

### Never do (unless user explicitly asks)
- `git push --force` to main/master
- `git reset --hard` (destroys work)
- `git checkout .` or `git restore .` (discards all changes)
- `git clean -f` (deletes untracked files)
- Skip hooks with `--no-verify`

## Reviewing Changes

```bash
# See what changed
git diff                    # unstaged changes
git diff --staged           # staged changes
git diff main...HEAD        # all changes on branch vs main
git log --oneline main..HEAD  # commits on branch
```

## Resolving Conflicts

1. `git status` to see conflicted files
2. Open each file — look for `<<<<<<<`, `=======`, `>>>>>>>`
3. Edit to keep the correct code, remove markers
4. `git add <file>` for each resolved file
5. `git commit` to finalize the merge

## Stashing

```bash
git stash                   # save work temporarily
git stash list              # see stashes
git stash pop               # restore most recent
```

## Undoing Mistakes

```bash
# Undo last commit (keep changes staged)
git reset --soft HEAD~1

# Unstage a file
git restore --staged file.ts

# Restore a specific file from last commit
git restore file.ts
```
