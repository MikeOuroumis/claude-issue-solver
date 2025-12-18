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

Use the release script to publish new versions:

```bash
npm run release              # Interactive prompts for version, title, changelog
npm run release 1.15.0       # Specify version directly
npm run release 1.15.0 "Feature name"  # Version + release title
```

The script handles: version bump in package.json, build, git commit, git tag, push, npm publish, and GitHub release creation.

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
