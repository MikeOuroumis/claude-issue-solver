import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, branchExists, getDefaultBranch } from '../utils/git';
import { slugify, copyEnvFiles, symlinkNodeModules, openInNewTerminal } from '../utils/helpers';

export interface SolveOptions {
  autoClose?: boolean;
}

export async function solveCommand(issueNumber: number, options: SolveOptions = {}): Promise<void> {
  const spinner = ora(`Fetching issue #${issueNumber}...`).start();

  const issue = getIssue(issueNumber);
  if (!issue) {
    spinner.fail(`Could not find issue #${issueNumber}`);
    process.exit(1);
  }

  spinner.succeed(`Found issue #${issueNumber}`);

  console.log();
  console.log(chalk.bold(`📌 Issue: ${issue.title}`));
  console.log(chalk.dim(`🔗 URL: ${issue.url}`));
  console.log();

  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const baseBranch = getDefaultBranch();
  const branchSlug = slugify(issue.title);
  const branchName = `issue-${issueNumber}-${branchSlug}`;
  const worktreePath = path.join(path.dirname(projectRoot), `${projectName}-${branchName}`);

  // Fetch latest base branch
  const fetchSpinner = ora(`Fetching latest ${baseBranch}...`).start();
  try {
    execSync(`git fetch origin ${baseBranch} --quiet`, { cwd: projectRoot, stdio: 'pipe' });
    fetchSpinner.succeed(`Fetched latest ${baseBranch}`);
  } catch {
    fetchSpinner.warn(`Could not fetch origin/${baseBranch}`);
  }

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    console.log(chalk.yellow(`\n🌿 Worktree already exists at: ${worktreePath}`));
    console.log(chalk.dim(`   Resuming work on issue #${issueNumber}...`));
  } else {
    const worktreeSpinner = ora(`Creating worktree with branch: ${branchName}`).start();

    try {
      if (branchExists(branchName)) {
        execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } else {
        execSync(`git worktree add "${worktreePath}" -b "${branchName}" origin/${baseBranch}`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      }
      worktreeSpinner.succeed(`Created worktree at: ${worktreePath}`);
    } catch (error) {
      worktreeSpinner.fail('Failed to create worktree');
      console.error(error);
      process.exit(1);
    }

    // Copy env files and symlink node_modules
    const setupSpinner = ora('Setting up worktree...').start();
    copyEnvFiles(projectRoot, worktreePath);
    symlinkNodeModules(projectRoot, worktreePath);
    setupSpinner.succeed('Worktree setup complete');
  }

  // Build the prompt for Claude and save to file (avoids shell escaping issues)
  const prompt = `Please solve this GitHub issue:

## Issue #${issueNumber}: ${issue.title}

${issue.body}

---

Instructions:
1. Analyze the issue and understand what needs to be done
2. Implement the necessary changes
3. Make sure to run tests if applicable
4. When done, commit your changes with a descriptive message that references the issue
5. After committing, create a PR that closes this issue (use "Closes #${issueNumber}" in the PR body)`;

  // Write prompt to a file to avoid shell escaping issues with backticks, <>, etc.
  const promptFile = path.join(worktreePath, '.claude-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  // Create runner script
  const runnerScript = path.join(worktreePath, '.claude-runner.sh');
  const autoClose = options.autoClose || false;

  const autoCloseEnding = `
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Claude session ended. Cleaning up worktree..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Remove worktree (need to cd out first)
cd "${projectRoot}"

# Try git worktree remove first
git worktree remove "${worktreePath}" --force 2>/dev/null

# If folder still exists, force delete it
if [ -d "${worktreePath}" ]; then
  echo "Git worktree remove didn't fully clean up, force deleting..."
  /bin/rm -rf "${worktreePath}" 2>/dev/null || rm -rf "${worktreePath}" 2>/dev/null
fi

# Prune any stale worktree references
git worktree prune 2>/dev/null

# Verify cleanup
if [ -d "${worktreePath}" ]; then
  echo "⚠️  Could not fully remove worktree. You may need to manually delete:"
  echo "   rm -rf '${worktreePath}'"
else
  echo "✅ Worktree removed. Branch '${branchName}' preserved on remote."
  echo "   Fetch it in main repo: git fetch origin ${branchName}"
fi

echo ""
echo "Terminal will close in 3 seconds..."
sleep 3

# Close the terminal window (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
  if [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
    osascript -e 'tell application "iTerm" to close (current window)' &
  else
    osascript -e 'tell application "Terminal" to close (first window whose selected tab contains (frontmost tab))' &
  fi
fi
exit 0
`;

  const interactiveEnding = `
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Claude session ended. Terminal staying open (--keep mode)."
echo "To clean up: claude-issue clean ${issueNumber}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep terminal open with minimal shell (skip rc files to avoid prompts)
exec bash --norc --noprofile
`;

  const modeMessage = autoClose
    ? 'Worktree will be cleaned up after session ends.'
    : 'Terminal and worktree will stay open (--keep mode).';

  const runnerContent = `#!/bin/bash
cd "${worktreePath}"

# Set terminal title
echo -ne "\\033]0;Issue #${issueNumber}: ${issue.title.replace(/"/g, '\\"').slice(0, 50)}\\007"

echo "🤖 Claude Code - Issue #${issueNumber}: ${issue.title}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "When Claude commits, a PR will be created automatically."
echo "${modeMessage}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Function to create PR
create_pr() {
  COMMITS=$(git log origin/${baseBranch}..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')

  if [ "$COMMITS" -gt 0 ]; then
    # Check if PR already exists
    EXISTING_PR=$(gh pr list --head "${branchName}" --json number --jq '.[0].number' 2>/dev/null)

    if [ -z "$EXISTING_PR" ]; then
      echo ""
      echo "📤 Pushing branch and creating PR..."

      git push -u origin "${branchName}" 2>/dev/null

      COMMIT_LIST=$(git log origin/${baseBranch}..HEAD --pretty=format:'- %s' | head -10)

      PR_URL=$(gh pr create \\
        --title "Fix #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}" \\
        --body "## Summary

Closes #${issueNumber}

## Changes

$COMMIT_LIST

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \\
        --head "${branchName}" \\
        --base ${baseBranch} 2>/dev/null)

      if [ -n "$PR_URL" ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "✅ PR CREATED!"
        echo ""
        echo "   $PR_URL"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        # Update terminal title with PR info
        PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
        echo -ne "\\033]0;Issue #${issueNumber} → PR #\$PR_NUM\\007"
      fi
    else
      # PR exists, just push new commits
      git push origin "${branchName}" 2>/dev/null
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "📤 Pushed new commits to PR #$EXISTING_PR"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
    fi
  fi
}

# Watch for new commits in background and create PR
LAST_COMMIT=""
while true; do
  CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null)
  if [ "$CURRENT_COMMIT" != "$LAST_COMMIT" ] && [ -n "$LAST_COMMIT" ]; then
    create_pr > /dev/null
  fi
  LAST_COMMIT="$CURRENT_COMMIT"
  sleep 2
done &
WATCHER_PID=$!

# Run Claude interactively
claude --dangerously-skip-permissions "$(cat '${promptFile}')"

# Clean up prompt file
rm -f '${promptFile}'

# Kill the watcher
kill $WATCHER_PID 2>/dev/null

# Final PR check after Claude exits
create_pr
${autoClose ? autoCloseEnding : interactiveEnding}`;

  fs.writeFileSync(runnerScript, runnerContent, { mode: 0o755 });

  console.log();
  console.log(chalk.cyan('🤖 Opening new terminal to run Claude Code...'));
  console.log();

  openInNewTerminal(`'${runnerScript}'`);

  console.log(chalk.green(`✅ Worktree created at: ${worktreePath}`));
  console.log(chalk.dim(`   Claude is running in a new terminal window.`));
  console.log();
  console.log(chalk.dim(`   You can also open VS Code: code ${worktreePath}`));
  console.log(chalk.dim(`   To clean up later: claude-issue clean ${issueNumber}`));
}
