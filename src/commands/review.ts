import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, branchExists, getDefaultBranch } from '../utils/git';
import { slugify, copyEnvFiles, symlinkNodeModules, openInNewTerminal } from '../utils/helpers';
import { getBotToken } from './config';

interface OpenPR {
  number: number;
  title: string;
  headRefName: string;
  issueNumber: number | null;
  reviewDecision: string | null;
}

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

  // Check for bot token early to include in prompt
  const botToken = getBotToken();
  const ghCmd = botToken ? `GH_TOKEN=\${BOT_TOKEN} gh` : 'gh';

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
${botToken ? `
**IMPORTANT: A bot token is configured. Use this prefix for ALL gh commands:**
\`\`\`bash
GH_TOKEN=\${BOT_TOKEN} gh pr review ...
GH_TOKEN=\${BOT_TOKEN} gh pr comment ...
\`\`\`
The BOT_TOKEN environment variable is already set in this terminal.

You can use formal reviews (approve/request-changes):

\`\`\`bash
# Post suggestions as review comments
GH_TOKEN=\${BOT_TOKEN} gh pr review ${prNumber} --comment --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"

# Final verdict
GH_TOKEN=\${BOT_TOKEN} gh pr review ${prNumber} --approve --body "LGTM! Code looks good."
# OR
GH_TOKEN=\${BOT_TOKEN} gh pr review ${prNumber} --request-changes --body "Please address the issues above."
\`\`\`
` : `
First, check if you can post formal reviews by running these commands:
\`\`\`bash
# Get PR author
PR_AUTHOR=$(gh pr view ${prNumber} --json author --jq .author.login)
# Get current user
CURRENT_USER=$(gh api user --jq .login)
echo "PR author: $PR_AUTHOR, Current user: $CURRENT_USER"
\`\`\`

### If PR author ≠ Current user (reviewing someone else's PR):
You can use formal reviews with approve/request-changes:

\`\`\`bash
# Post suggestions as review comments
gh pr review ${prNumber} --comment --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"

# Final verdict
gh pr review ${prNumber} --approve --body "LGTM! Code looks good."
# OR
gh pr review ${prNumber} --request-changes --body "Please address the issues above."
\`\`\`

### If PR author = Current user (reviewing your own PR):
You can only post comments (GitHub doesn't allow self-review):

\`\`\`bash
gh pr comment ${prNumber} --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"
\`\`\`
`}
The \`suggestion\` code block creates a "Commit suggestion" button on GitHub.

## PR Diff
${diffContent ? `\n\`\`\`diff\n${diffContent.slice(0, 50000)}\n\`\`\`\n` : 'Run `gh pr diff ' + prNumber + '` to see the changes.'}

Start by examining the diff and the changed files, then provide your review.`;

  // Write prompt to a file
  const promptFile = path.join(worktreePath, '.claude-review-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  // Bot token already fetched above
  const botTokenEnv = botToken ? `export BOT_TOKEN="${botToken}"\nexport GH_TOKEN="${botToken}"` : '# No bot token configured';
  const botNote = botToken
    ? 'Using bot token for reviews (can approve/request changes)'
    : 'No bot token - using your account (may have limitations on own PRs)';

  // Create runner script for review
  const runnerScript = path.join(worktreePath, '.claude-review-runner.sh');
  const runnerContent = `#!/bin/bash
cd "${worktreePath}"

# Set bot token if configured
${botTokenEnv}

# Set terminal title
echo -ne "\\033]0;Review PR #${prNumber}: ${issue.title.replace(/"/g, '\\"').slice(0, 50)}\\007"

echo "🔍 Claude Code Review - PR #${prNumber}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Issue #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}"
echo ""
echo "${botNote}"
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

function getOpenPRs(projectRoot: string): OpenPR[] {
  try {
    const output = execSync(
      'gh pr list --state open --json number,title,headRefName,reviewDecision --limit 50',
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const prs = JSON.parse(output) as { number: number; title: string; headRefName: string; reviewDecision: string | null }[];

    return prs.map((pr) => {
      // Try to extract issue number from branch name (issue-42-slug)
      const match = pr.headRefName.match(/^issue-(\d+)-/);
      return {
        ...pr,
        issueNumber: match ? parseInt(match[1], 10) : null,
        reviewDecision: pr.reviewDecision,
      };
    });
  } catch {
    return [];
  }
}

export async function selectReviewCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();

  console.log(chalk.bold(`\nOpen PRs for ${projectName}:\n`));

  const spinner = ora('Fetching open PRs...').start();
  const prs = getOpenPRs(projectRoot);
  spinner.stop();

  if (prs.length === 0) {
    console.log(chalk.yellow('No open PRs found.'));
    return;
  }

  // Build choices for checkbox prompt
  const choices = prs.map((pr) => {
    const issueTag = pr.issueNumber ? chalk.dim(` (issue #${pr.issueNumber})`) : '';
    let statusTag = '';
    switch (pr.reviewDecision) {
      case 'APPROVED':
        statusTag = chalk.green(' ✓ Approved');
        break;
      case 'CHANGES_REQUESTED':
        statusTag = chalk.red(' ✗ Changes requested');
        break;
      case 'REVIEW_REQUIRED':
        statusTag = chalk.yellow(' ○ Review required');
        break;
      default:
        statusTag = chalk.dim(' ○ No reviews');
    }
    return {
      name: `#${pr.number}\t${pr.title}${issueTag}${statusTag}`,
      value: pr,
      checked: false,
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select PRs to review (space to toggle, enter to confirm):',
      choices,
    },
  ]);

  if (selected.length === 0) {
    console.log(chalk.dim('No PRs selected.'));
    return;
  }

  console.log();
  console.log(chalk.cyan(`🔍 Starting ${selected.length} review session(s) in parallel...`));
  console.log();

  // Launch reviews in parallel
  for (const pr of selected as OpenPR[]) {
    await launchReviewForPR(pr, projectRoot, projectName);
  }

  console.log();
  console.log(chalk.green(`✅ Started ${selected.length} review session(s)!`));
  console.log(chalk.dim('   Each review is running in its own terminal window.'));
}

async function launchReviewForPR(
  pr: OpenPR,
  projectRoot: string,
  projectName: string
): Promise<void> {
  const baseBranch = getDefaultBranch();
  const branchName = pr.headRefName;
  const worktreePath = path.join(path.dirname(projectRoot), `${projectName}-${branchName}`);

  // Fetch latest
  try {
    execSync(`git fetch origin ${branchName} --quiet`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // Ignore fetch errors
  }

  // Check if worktree already exists
  if (!fs.existsSync(worktreePath)) {
    try {
      if (branchExists(branchName)) {
        execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } else {
        execSync(`git worktree add "${worktreePath}" "origin/${branchName}"`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      }

      // Copy env files and symlink node_modules
      copyEnvFiles(projectRoot, worktreePath);
      symlinkNodeModules(projectRoot, worktreePath);
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not create worktree for PR #${pr.number}`));
      return;
    }
  } else {
    // Pull latest changes
    try {
      execSync('git pull --quiet', { cwd: worktreePath, stdio: 'pipe' });
    } catch {
      // Ignore pull errors
    }
  }

  // Get the diff for context
  let diffContent = '';
  try {
    diffContent = execSync(`gh pr diff ${pr.number}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    // Ignore diff errors
  }

  // Get issue body if we have an issue number
  let issueBody = '';
  if (pr.issueNumber) {
    const issue = getIssue(pr.issueNumber);
    if (issue) {
      issueBody = issue.body;
    }
  }

  // Check for bot token
  const botToken = getBotToken();

  // Build the review prompt
  const prompt = `You are reviewing PR #${pr.number}: ${pr.title}
${pr.issueNumber ? `\n## Related Issue #${pr.issueNumber}\n${issueBody}\n` : ''}
## Your Task
Review the code changes in this PR. Look for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Missing error handling
4. Code quality issues
5. Missing tests
6. Performance problems

## How to Leave Feedback
${botToken ? `
**IMPORTANT: A bot token is configured. Use this prefix for ALL gh commands:**
\`\`\`bash
GH_TOKEN=\${BOT_TOKEN} gh pr review ...
GH_TOKEN=\${BOT_TOKEN} gh pr comment ...
\`\`\`
The BOT_TOKEN environment variable is already set in this terminal.

You can use formal reviews (approve/request-changes):

\`\`\`bash
# Post suggestions as review comments
GH_TOKEN=\${BOT_TOKEN} gh pr review ${pr.number} --comment --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"

# Final verdict
GH_TOKEN=\${BOT_TOKEN} gh pr review ${pr.number} --approve --body "LGTM! Code looks good."
# OR
GH_TOKEN=\${BOT_TOKEN} gh pr review ${pr.number} --request-changes --body "Please address the issues above."
\`\`\`
` : `
First, check if you can post formal reviews by running these commands:
\`\`\`bash
# Get PR author
PR_AUTHOR=$(gh pr view ${pr.number} --json author --jq .author.login)
# Get current user
CURRENT_USER=$(gh api user --jq .login)
echo "PR author: $PR_AUTHOR, Current user: $CURRENT_USER"
\`\`\`

### If PR author ≠ Current user (reviewing someone else's PR):
You can use formal reviews with approve/request-changes:

\`\`\`bash
# Post suggestions as review comments
gh pr review ${pr.number} --comment --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"

# Final verdict
gh pr review ${pr.number} --approve --body "LGTM! Code looks good."
# OR
gh pr review ${pr.number} --request-changes --body "Please address the issues above."
\`\`\`

### If PR author = Current user (reviewing your own PR):
You can only post comments (GitHub doesn't allow self-review):

\`\`\`bash
gh pr comment ${pr.number} --body "**File: path/to/file.ts**

Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`
"
\`\`\`
`}
The \`suggestion\` code block creates a "Commit suggestion" button on GitHub.

## PR Diff
${diffContent ? `\n\`\`\`diff\n${diffContent.slice(0, 50000)}\n\`\`\`\n` : 'Run `gh pr diff ' + pr.number + '` to see the changes.'}

Start by examining the diff and the changed files, then provide your review.`;

  // Write prompt to a file
  const promptFile = path.join(worktreePath, '.claude-review-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  const botTokenEnv = botToken ? `export BOT_TOKEN="${botToken}"\nexport GH_TOKEN="${botToken}"` : '# No bot token configured';
  const botNote = botToken
    ? 'Using bot token for reviews (can approve/request changes)'
    : 'No bot token - using your account (may have limitations on own PRs)';

  // Create runner script for review
  const runnerScript = path.join(worktreePath, '.claude-review-runner.sh');
  const escapedTitle = pr.title.replace(/"/g, '\\"').slice(0, 50);
  const runnerContent = `#!/bin/bash
cd "${worktreePath}"

# Set bot token if configured
${botTokenEnv}

# Set terminal title
echo -ne "\\033]0;Review PR #${pr.number}: ${escapedTitle}\\007"

echo "🔍 Claude Code Review - PR #${pr.number}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "${escapedTitle}"
echo ""
echo "${botNote}"
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
echo "View PR: gh pr view ${pr.number} --web"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep terminal open
exec bash
`;

  fs.writeFileSync(runnerScript, runnerContent, { mode: 0o755 });

  console.log(chalk.dim(`   Starting review for PR #${pr.number}: ${pr.title.slice(0, 50)}...`));

  openInNewTerminal(`'${runnerScript}'`);
}
