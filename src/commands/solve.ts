import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, branchExists } from '../utils/git';
import { slugify, copyEnvFiles, symlinkNodeModules, openInNewTerminal } from '../utils/helpers';

export async function solveCommand(issueNumber: number): Promise<void> {
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
  const branchSlug = slugify(issue.title);
  const branchName = `issue-${issueNumber}-${branchSlug}`;
  const worktreePath = path.join(path.dirname(projectRoot), `${projectName}-${branchName}`);

  // Fetch latest main
  const fetchSpinner = ora('Fetching latest main...').start();
  try {
    execSync('git fetch origin main --quiet', { cwd: projectRoot, stdio: 'pipe' });
    fetchSpinner.succeed('Fetched latest main');
  } catch {
    fetchSpinner.warn('Could not fetch origin/main');
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
        execSync(`git worktree add "${worktreePath}" -b "${branchName}" origin/main`, {
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

  // Build the prompt for Claude
  const prompt = `Please solve this GitHub issue:

## Issue #${issueNumber}: ${issue.title}

${issue.body}

---

Instructions:
1. Analyze the issue and understand what needs to be done
2. Implement the necessary changes
3. Make sure to run tests if applicable
4. When done, commit your changes with a descriptive message that references the issue`;

  // Create runner script
  const runnerScript = path.join(worktreePath, '.claude-runner.sh');
  const runnerContent = `#!/bin/bash
cd "${worktreePath}"
echo "🤖 Claude Code - Issue #${issueNumber}: ${issue.title}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Claude will stay open after solving the issue."
echo "You can ask for more changes or type /exit when done."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

claude --dangerously-skip-permissions "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Claude session ended."
echo ""

COMMITS=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')

if [ "$COMMITS" -eq 0 ]; then
  echo "⚠️  No commits were made."
  echo "To clean up: claude-issue clean ${issueNumber}"
else
  echo "✅ Found $COMMITS commit(s)"
  echo ""
  read -p "Create PR to close issue #${issueNumber}? (Y/n) " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo ""
    echo "📤 Pushing branch and creating PR..."

    git push -u origin "${branchName}"

    COMMIT_LIST=$(git log origin/main..HEAD --pretty=format:'- %s' | head -10)

    PR_URL=$(gh pr create \\
      --title "Fix #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}" \\
      --body "## Summary

Closes #${issueNumber}

## Changes

$COMMIT_LIST

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \\
      --head "${branchName}" \\
      --base main)

    echo ""
    echo "✅ PR created: $PR_URL"
    echo ""
    echo "The PR will automatically close issue #${issueNumber} when merged."
  fi

  echo ""
  echo "To clean up after merge: claude-issue clean ${issueNumber}"
fi

echo ""
rm -f "${runnerScript}"
`;

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
