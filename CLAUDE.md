# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Issue Solver is a CLI tool that automates GitHub issue solving using Claude Code. It fetches issues, creates git worktrees for isolation, launches Claude Code in a new terminal to solve the issue, and creates PRs when done.

## Build & Development Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Run from source with ts-node
npm link           # Install locally for testing as `claude-issue` or `cis`
```

## Releasing

Since the release script requires interactive input, do the release steps manually:

```bash
# 1. Update version in package.json
# 2. Build and commit
npm run build
git add -A
git commit -m "feat: description of changes"
git add package.json
git commit -m "X.Y.Z"  # version number only

# 3. Tag and push
git tag "vX.Y.Z"
git push origin main
git push origin "vX.Y.Z"

# 4. Publish to npm
npm publish

# 5. Create GitHub release
gh release create "vX.Y.Z" --title "vX.Y.Z - Release title" --notes "### What's New

- Feature 1
- Feature 2"
```

All 5 steps are required for a complete release. Do not skip the GitHub release step.

## Architecture

**Entry point**: `src/index.ts` - Uses Commander.js to define CLI commands. All commands require being in a git repo and having `gh` (GitHub CLI) and `claude` (Claude Code) installed.

**Commands** (`src/commands/`):
- `solve.ts` - Main workflow: fetches issue, creates worktree, writes a runner script that launches Claude Code with `--dangerously-skip-permissions`, watches for commits to auto-create PRs
- `select.ts` - Interactive multi-select issue picker using inquirer (checkbox); can select multiple issues to solve in parallel
- `list.ts` - Lists open GitHub issues with [PR] indicator for issues that have open PRs
- `pr.ts` - Manual PR creation for an issue
- `clean.ts` - Removes worktrees and branches; supports `--merged` flag to auto-clean only merged PRs
- `go.ts` - Navigate to worktrees, open VS Code, or view PRs

**Scripts** (`scripts/`):
- `release.ts` - Automated release script: bumps version, builds, commits, tags, pushes, publishes to npm, creates GitHub release

**Utilities** (`src/utils/`):
- `git.ts` - Git operations (exec wrappers, branch checks, project root/name detection)
- `github.ts` - GitHub CLI wrappers for issues and PRs (uses `gh` command)
- `helpers.ts` - Terminal opening (iTerm2/Terminal.app/Linux), env file copying, node_modules symlinking, slugify

## Key Implementation Details

- Worktrees are created in the parent directory with naming: `{project-name}-issue-{number}-{slug}`
- Branch naming: `issue-{number}-{slug}` (slug limited to 30 chars)
- The solve command writes a bash runner script to the worktree that handles PR creation on commit
- PR creation happens automatically via a background watcher that monitors for new commits
- Terminal opening uses AppleScript for macOS (iTerm2 preferred, Terminal.app fallback)
- Clean command can close VS Code and terminal windows for the worktree (macOS only)
