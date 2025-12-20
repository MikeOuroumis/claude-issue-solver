import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, branchExists, getDefaultBranch } from '../utils/git';
import { slugify, copyEnvFiles, symlinkNodeModules, openInNewTerminal } from '../utils/helpers';

export async function reviewCommand(issueNumber: number): Promise<void> {
  const spinner = ora(`Fetching issue #${issueNumber}...`).start();

  const issue = getIssue(issueNumber);
  if (!issue) {
    spinner.fail(`Could not find issue #${issueNumber}`);
    process.exit(1);
  }

  spinner.succeed(`Found issue #${issueNumber}`);

  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const baseBranch = getDefaultBranch();
  const branchSlug = slugify(issue.title);
  const branchName = `issue-${issueNumber}-${branchSlug}`;
  const worktreePath = path.join(path.dirname(projectRoot), `${projectName}-${branchName}`);

  // Check if there's a PR for this issue
  const prCheckSpinner = ora('Checking for PR...').start();
  let prNumber: string | null = null;
  try {
    const prOutput = execSync(`gh pr list --head "${branchName}" --json number --jq '.[0].number'`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (prOutput) {
      prNumber = prOutput;
      prCheckSpinner.succeed(`Found PR #${prNumber}`);
    } else {
      prCheckSpinner.fail('No PR found for this issue');
      console.log(chalk.yellow('\nA PR must exist before you can review it.'));
      console.log(chalk.dim(`First solve the issue: claude-issue ${issueNumber}`));
      process.exit(1);
    }
  } catch {
    prCheckSpinner.fail('Could not check for PR');
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold(`📌 Reviewing: ${issue.title}`));
  console.log(chalk.dim(`🔗 PR: https://github.com/${getRepoName(projectRoot)}/pull/${prNumber}`));
  console.log();

  // Fetch latest
  const fetchSpinner = ora(`Fetching latest changes...`).start();
  try {
    execSync(`git fetch origin ${branchName} --quiet`, { cwd: projectRoot, stdio: 'pipe' });
    fetchSpinner.succeed('Fetched latest changes');
  } catch {
    fetchSpinner.warn('Could not fetch branch');
  }

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    console.log(chalk.yellow(`\n🌿 Using existing worktree at: ${worktreePath}`));
    // Pull latest changes
    try {
      execSync('git pull --quiet', { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      // Ignore pull errors
    }
  } else {
    const worktreeSpinner = ora(`Creating worktree for review...`).start();

    try {
      if (branchExists(branchName)) {
        execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } else {
        // Branch should exist if PR exists, but handle edge case
        execSync(`git worktree add "${worktreePath}" "origin/${branchName}"`, {
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

  // Get the diff for context
  let diffContent = '';
  try {
    diffContent = execSync(`gh pr diff ${prNumber}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
    });
  } catch {
    console.log(chalk.yellow('Could not fetch PR diff, Claude will review the files directly.'));
  }

  // Build the review prompt
  const prompt = `You are reviewing PR #${prNumber} for issue #${issueNumber}: ${issue.title}

## Issue Description
${issue.body}

## Your Task
Review the code changes in this PR. Look for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Missing error handling
4. Code quality issues
5. Missing tests
6. Performance problems

## How to Leave Feedback
Use the gh CLI to post review comments with suggestions. For each issue you find:

\`\`\`bash
gh pr review ${prNumber} --comment --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"
\`\`\`

The \`suggestion\` code block will create a "Commit suggestion" button on GitHub.

For a final review summary, use:
\`\`\`bash
gh pr review ${prNumber} --comment --body "## Review Summary

- Issue 1: ...
- Issue 2: ...

Overall: [APPROVE/REQUEST_CHANGES/COMMENT]"
\`\`\`

Or to approve/request changes formally:
\`\`\`bash
gh pr review ${prNumber} --approve --body "LGTM! Code looks good."
gh pr review ${prNumber} --request-changes --body "Please address the issues above."
\`\`\`

## PR Diff
${diffContent ? `\n\`\`\`diff\n${diffContent.slice(0, 50000)}\n\`\`\`\n` : 'Run `gh pr diff ' + prNumber + '` to see the changes.'}

Start by examining the diff and the changed files, then provide your review.`;

  // Write prompt to a file
  const promptFile = path.join(worktreePath, '.claude-review-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  // Create runner script for review
  const runnerScript = path.join(worktreePath, '.claude-review-runner.sh');
  const runnerContent = `#!/bin/bash
cd "${worktreePath}"

# Set terminal title
echo -ne "\\033]0;Review PR #${prNumber}: ${issue.title.replace(/"/g, '\\"').slice(0, 50)}\\007"

echo "🔍 Claude Code Review - PR #${prNumber}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Issue #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}"
echo ""
echo "Claude will review the PR and post suggestions."
echo "You can commit suggestions directly on GitHub."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run Claude interactively
claude --dangerously-skip-permissions "$(cat '${promptFile}')"

# Clean up prompt file
rm -f '${promptFile}'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Review session ended."
echo ""
echo "View PR: gh pr view ${prNumber} --web"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep terminal open
exec bash
`;

  fs.writeFileSync(runnerScript, runnerContent, { mode: 0o755 });

  console.log();
  console.log(chalk.cyan('🔍 Opening new terminal for code review...'));
  console.log();

  openInNewTerminal(`'${runnerScript}'`);

  console.log(chalk.green(`✅ Review session started for PR #${prNumber}`));
  console.log(chalk.dim(`   Claude is reviewing in a new terminal window.`));
  console.log();
  console.log(chalk.dim(`   View PR: gh pr view ${prNumber} --web`));
  console.log(chalk.dim(`   To clean up later: claude-issue clean ${issueNumber}`));
}

function getRepoName(projectRoot: string): string {
  try {
    const output = execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch {
    return '';
  }
}
