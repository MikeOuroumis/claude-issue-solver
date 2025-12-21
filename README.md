# Claude Issue Solver

<p align="center">
  <img src="claude-issue-solver-logo.webp" alt="Claude Issue Solver Logo" width="200">
</p>

[![npm version](https://img.shields.io/npm/v/claude-issue-solver.svg)](https://www.npmjs.com/package/claude-issue-solver)
[![npm downloads](https://img.shields.io/npm/dm/claude-issue-solver.svg)](https://www.npmjs.com/package/claude-issue-solver)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatically solve GitHub issues using [Claude Code](https://claude.ai/code).

This CLI tool fetches an issue from your repo, creates a worktree, opens Claude Code in a new terminal to solve it, and creates a PR when done.

> **⚠️ DISCLAIMER: USE AT YOUR OWN RISK**
>
> This tool runs Claude Code with the `--dangerously-skip-permissions` flag, which allows Claude to execute commands and modify files **without asking for confirmation**. This is powerful but potentially risky.
>
> **Before using this tool:**
> - Understand that Claude will have unrestricted access to your codebase
> - Review what Claude is doing in the terminal
> - Use git to review changes before merging PRs
> - Never run this on production systems or sensitive repositories without careful consideration
>
> By using this tool, you accept full responsibility for any changes made to your code.

## Demo

```bash
$ cis

Open issues for my-project:

? Select issues to solve (space to select, enter to confirm):
❯ ◯ #42  Add dark mode support
  ◯ #38  Fix login bug on mobile [PR]
  ◯ #35  Update dependencies

# Select multiple issues, then press enter...

Starting 2 issue(s)...

📋 Fetching issue #42...
✔ Found issue #42
📌 Issue: Add dark mode support
🌿 Creating worktree with branch: issue-42-add-dark-mode-support
🤖 Opening new terminal to run Claude Code...

✅ Worktree created at: ../my-project-issue-42-add-dark-mode-support
   Claude is running in a new terminal window.

📋 Fetching issue #35...
...
```

## Features

- 🎯 **Multi-select issues** - Select multiple issues to solve in parallel, each in its own terminal
- ✨ **Create and solve** - Create new issues and start solving them immediately
- 🌿 **Worktree isolation** - Each issue gets its own worktree, work on multiple issues in parallel
- 🤖 **Real-time PR creation** - Automatically creates/updates PR as Claude commits changes
- 🔍 **AI code review** - Review PRs with Claude, posts suggestions you can commit directly on GitHub
- 🧹 **Smart cleanup** - Auto-clean merged PRs, close VS Code/terminal windows on macOS
- 📁 **Monorepo support** - Recursively copies all `.env*` files, symlinks `node_modules`
- 💻 **Cross-platform terminals** - iTerm2, Terminal.app (macOS), gnome-terminal, xterm, konsole (Linux)

## Requirements

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code CLI](https://claude.ai/code) - `npm install -g @anthropic-ai/claude-code`
- [GitHub CLI](https://cli.github.com/) - `brew install gh` (and run `gh auth login`)
- Git

## Installation

```bash
npm install -g claude-issue-solver
```

Then run the setup wizard to check/install requirements:

```bash
claude-issue init
```

This will:
- Check for Node.js, GitHub CLI, Claude Code, and Git
- Install missing tools (on macOS via Homebrew)
- Guide you through authentication for `gh` and `claude`

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

# Or use the short alias
cis

# Solve a specific issue directly
claude-issue 42

# List open issues
claude-issue list
claude-issue ls
claude-issue list --verbose   # Show descriptions

# Show full issue details
claude-issue show 42

# Create a new issue and solve it immediately
claude-issue new "Add dark mode support"
claude-issue new "Fix login bug" -b "Users can't login on mobile"
claude-issue new "Fix crash" -l bug -l priority

# Create PR for a solved issue (if you skipped it earlier)
claude-issue pr 42

# Review PRs with AI (posts suggestions you can commit on GitHub)
claude-issue review          # Interactive: select PRs to review in parallel
claude-issue review 42       # Review specific issue's PR

# Clean up worktree and branch
claude-issue clean 42        # Clean specific issue
claude-issue clean           # Interactive selection
claude-issue clean --all     # Clean all worktrees (with confirmation)
claude-issue clean --merged  # Auto-clean only merged PRs (no confirmation)

# Navigate to a worktree or open its PR
claude-issue go              # Interactive selection
claude-issue go 42           # Go to specific issue

# Show help
claude-issue --help
```

## Commands Reference

| Command | Alias | Description |
|---------|-------|-------------|
| `claude-issue` | `cis` | Interactive issue selection |
| `claude-issue <number>` | - | Solve specific issue |
| `claude-issue new <title>` | - | Create issue and solve it |
| `claude-issue list` | `ls` | List open issues |
| `claude-issue show <number>` | - | Show full issue details |
| `claude-issue pr <number>` | - | Create PR for solved issue |
| `claude-issue review [number]` | - | Review PRs with AI suggestions |
| `claude-issue config` | - | Manage settings (bot token) |
| `claude-issue clean [number]` | `rm` | Remove worktree and branch |
| `claude-issue go [number]` | - | Navigate to worktree |
| `claude-issue init` | - | Setup wizard for requirements |

### Command Options

**`list` command:**
- `--verbose` - Show issue descriptions
- `-n, --limit <number>` - Maximum issues to show (default: 50)
- `--all` - Show all issues (no limit)

**`new` command:**
- `-b, --body <text>` - Issue description
- `-l, --label <name>` - Add label (can be used multiple times)

**`clean` command:**
- `-a, --all` - Clean all issue worktrees (with confirmation)
- `-m, --merged` - Clean only worktrees with merged PRs (no confirmation)

**`config` command:**
- `cis config` - Show current configuration
- `cis config bot-token` - Set up a bot token for reviews
- `cis config --clear` - Clear all configuration

## How it works

1. **Fetches issue** - Gets title and description from GitHub
2. **Creates worktree** - Makes a new git worktree with branch `issue-{number}-{slug}`
3. **Sets up environment** - Recursively copies all `.env*` files, symlinks `node_modules`
4. **Opens Claude** - Launches Claude Code in a new terminal with the issue as context
5. **Real-time PR creation** - Background watcher creates PR on first commit, pushes updates on subsequent commits
6. **Interactive session** - Claude stays open so you can ask for changes

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
│ Auto-create PR  │
│ "Closes #42"    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ claude-issue    │
│ clean --merged  │
└─────────────────┘
```

## Smart Features

### Issue Filtering
When selecting issues, the tool automatically hides issues that already have open PRs from `issue-{number}-*` branches. A message shows how many were hidden.

### PR Status Display
When cleaning, the tool shows the status of each worktree:
- `✓ PR merged` - Safe to clean
- `◐ PR open` - PR still under review
- `✗ PR closed` - PR was closed without merging
- `● Issue closed` - Issue was closed
- `○ Issue open` - Issue still open

### Orphaned Folder Cleanup
If a worktree folder exists but isn't registered in git (e.g., after a failed cleanup), the tool detects it and offers to remove it.

### Auto-Close Windows (macOS)
When cleaning a worktree, the tool automatically closes related terminal windows (iTerm2/Terminal.app) and VS Code windows that have the worktree open.

### Monorepo Support
The tool recursively finds and copies all `.env*` files from your project, preserving directory structure. This works great with turborepo and other monorepo setups where env files exist in subdirectories like `apps/myapp/.env.local`.

Skipped directories: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`

### Branch Naming
Branches are named `issue-{number}-{slug}` where the slug is:
- Lowercase with hyphens
- Max 30 characters
- Bracket prefixes removed (e.g., `[Bug]` is stripped)
- Duplicate consecutive words removed (e.g., `fix-fix-bug` → `fix-bug`)

### AI Code Review
The `review` command lets Claude review PRs and post suggestions:

```bash
cis review          # Select PRs to review (parallel)
cis review 42       # Review specific issue's PR
```

Claude auto-detects whether you're reviewing your own PR or someone else's:
- **Your own PR**: Posts comments with suggestions (GitHub limitation)
- **Someone else's PR**: Can approve or request changes

**Bot Token (Optional)**: Set up a bot token to get full review capabilities on your own PRs:
```bash
cis config bot-token    # Interactive setup with instructions
```

> **Note**: For private repos, use a **Classic Token** with `repo` scope. Fine-grained tokens don't work well for collaborator access to repos you don't own.

## Tips

- PRs are created automatically when Claude makes commits - no need to wait until the end
- Use `claude-issue clean --merged` after merging PRs for quick cleanup
- Worktrees share the same `.git` so commits are visible in the main repo
- You can work on multiple issues in parallel - each gets its own worktree and terminal
- Use `claude-issue go` to quickly navigate to worktrees or open PRs in browser
- The `go` command also offers options to open in Finder (macOS) or copy the cd command

## Platform Support

| Feature | macOS | Linux |
|---------|-------|-------|
| New terminal window | iTerm2, Terminal.app | gnome-terminal, xterm, konsole |
| Auto-close terminals on clean | ✓ | - |
| Auto-close VS Code on clean | ✓ | - |
| Open in Finder | ✓ | - |

## License

MIT
