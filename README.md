# Claude Issue Solver

Automatically solve GitHub issues using [Claude Code](https://claude.ai/code).

This CLI tool fetches an issue from your repo, creates a worktree, opens Claude Code in a new terminal to solve it, and creates a PR when done.

## Demo

```bash
$ claude-issue

Open issues for my-project:

? Select an issue to solve:
❯ #42  Add dark mode support
  #38  Fix login bug on mobile
  #35  Update dependencies
  Cancel

📋 Fetching issue #42...
✔ Found issue #42
📌 Issue: Add dark mode support
🌿 Creating worktree with branch: issue-42-add-dark-mode-support
🤖 Opening new terminal to run Claude Code...

✅ Worktree created at: ../my-project-issue-42-add-dark-mode-support
   Claude is running in a new terminal window.
```

## Features

- 🎯 **Interactive issue selection** - Lists open issues with arrow-key navigation
- 🌿 **Worktree isolation** - Each issue gets its own worktree, work on multiple issues in parallel
- 🤖 **Automatic PR creation** - Creates a PR that closes the issue when merged
- 📁 **Works with any repo** - Auto-detects project name from git remote
- 💻 **Opens in new terminal** - Keeps your current terminal free (supports iTerm2 and Terminal.app on macOS)

## Requirements

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://claude.ai/code) - `npm install -g @anthropic-ai/claude-code`
- [GitHub CLI](https://cli.github.com/) - `brew install gh` (and run `gh auth login`)
- Git

## Installation

```bash
npm install -g claude-issue-solver
```

Or install from source:

```bash
git clone https://github.com/MikeOuroumis/claude-issue-solver.git
cd claude-issue-solver
npm install
npm run build
npm link
```

## Usage

Run from any git repository with GitHub issues:

```bash
# Interactive: show issues and select one
claude-issue

# Solve a specific issue directly
claude-issue 42

# List open issues
claude-issue list

# Create PR for a solved issue (if you skipped it earlier)
claude-issue pr 42

# Clean up worktree and branch after PR is merged
claude-issue clean 42

# Show help
claude-issue --help
```

## How it works

1. **Fetches issue** - Gets title and description from GitHub
2. **Creates worktree** - Makes a new git worktree with branch `issue-{number}-{slug}`
3. **Sets up environment** - Copies `.env` files, symlinks `node_modules`
4. **Opens Claude** - Launches Claude Code in a new terminal with the issue as context
5. **Interactive session** - Claude stays open so you can ask for changes
6. **Creates PR** - When you exit, prompts to create a PR that closes the issue

## Workflow

```
┌─────────────────┐
│  claude-issue   │
│   (select 42)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create worktree │
│ ../project-issue│
│ -42-fix-bug     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Open new term   │
│ with Claude     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Claude solves   │
│ issue & commits │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create PR       │
│ "Closes #42"    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ claude-issue    │
│ clean 42        │
└─────────────────┘
```

## Tips

- Use `/exit` in Claude to end the session and trigger PR creation
- Worktrees share the same `.git` so commits are visible in main repo
- Run `claude-issue clean <number>` after merging to clean up
- You can work on multiple issues in parallel - each gets its own worktree

## License

MIT
