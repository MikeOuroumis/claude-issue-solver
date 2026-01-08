import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName } from '../utils/git';
import { openInNewTerminal } from '../utils/helpers';
import { getBotToken } from './config';

interface OpenPR {
  number: number;
  title: string;
  headRefName: string;
  issueNumber: number | null;
  reviewDecision: string | null;
}

export async function reviewCommand(issueNumber: number, options: { merge?: boolean } = {}): Promise<void> {
  const spinner = ora(`Fetching issue #${issueNumber}...`).start();

  const issue = getIssue(issueNumber);
  if (!issue) {
    spinner.fail(`Could not find issue #${issueNumber}`);
    process.exit(1);
  }

  spinner.succeed(`Found issue #${issueNumber}`);

  const projectRoot = getProjectRoot();

  // Check if there's a PR for this issue - search by issue number in all PRs
  const prCheckSpinner = ora('Checking for PR...').start();
  let prNumber: string | null = null;
  let branchName: string | null = null;
  try {
    // Search for PRs that mention the issue number in their branch name
    const prOutput = execSync(
      `gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | test("issue-${issueNumber}-")) | "\\(.number) \\(.headRefName)"'`,
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    ).trim();
    if (prOutput) {
      const [num, branch] = prOutput.split(' ');
      prNumber = num;
      branchName = branch;
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

**IMPORTANT: Submit only ONE review to avoid duplicate reviews on GitHub.**

${botToken ? `A bot token is configured. Use this prefix for ALL gh commands:
\`\`\`bash
GH_TOKEN=\${BOT_TOKEN} gh pr review ...
\`\`\`
The BOT_TOKEN environment variable is already set in this terminal.

Collect all your feedback and submit it in a SINGLE review command:

\`\`\`bash
# If the code looks good:
GH_TOKEN=\${BOT_TOKEN} gh pr review ${prNumber} --approve --body "LGTM! Code looks good."

# If there are issues to address:
GH_TOKEN=\${BOT_TOKEN} gh pr review ${prNumber} --request-changes --body "## Review Feedback

**File: path/to/file.ts**
Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`

**File: another/file.ts**
Another issue...
"
\`\`\`
` : `First, check if you can post formal reviews by running these commands:
\`\`\`bash
# Get PR author
PR_AUTHOR=$(gh pr view ${prNumber} --json author --jq .author.login)
# Get current user
CURRENT_USER=$(gh api user --jq .login)
echo "PR author: $PR_AUTHOR, Current user: $CURRENT_USER"
\`\`\`

### If PR author ≠ Current user (reviewing someone else's PR):
Collect all your feedback and submit it in a SINGLE review command:

\`\`\`bash
# If the code looks good:
gh pr review ${prNumber} --approve --body "LGTM! Code looks good."

# If there are issues to address:
gh pr review ${prNumber} --request-changes --body "## Review Feedback

**File: path/to/file.ts**
Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`

**File: another/file.ts**
Another issue...
"
\`\`\`

### If PR author = Current user (reviewing your own PR):
You can only post comments (GitHub doesn't allow self-review):

\`\`\`bash
gh pr comment ${prNumber} --body "## Self-Review Notes

**File: path/to/file.ts**
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

  // Write prompt and runner script to temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cis-review-'));
  const promptFile = path.join(tempDir, '.claude-review-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  // Bot token already fetched above
  const botTokenEnv = botToken ? `export BOT_TOKEN="${botToken}"\nexport GH_TOKEN="${botToken}"` : '# No bot token configured';
  const botNote = botToken
    ? 'Using bot token for reviews (can approve/request changes)'
    : 'No bot token - using your account (may have limitations on own PRs)';

  // Create runner script for review
  const runnerScript = path.join(tempDir, '.claude-review-runner.sh');
  const runnerContent = `#!/bin/bash
cd "${projectRoot}"

# Disable Oh My Zsh auto-update prompt to prevent blocking
export DISABLE_AUTO_UPDATE="true"

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
${options.merge ? 'echo "\\n🔄 Auto-merge enabled: will merge if approved."' : ''}
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run Claude interactively
claude --dangerously-skip-permissions "$(cat '${promptFile}')"

# Clean up temp files
rm -rf '${tempDir}'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Review session ended."
echo ""

# Check if PR was approved
REVIEW_STATUS=$(gh pr view ${prNumber} --json reviewDecision --jq '.reviewDecision' 2>/dev/null)

if [ "$REVIEW_STATUS" = "APPROVED" ]; then
  echo "✅ PR #${prNumber} is approved!"
  echo ""
${options.merge ? `  echo "📤 Auto-merging PR #${prNumber}..."
  if gh pr merge ${prNumber} --squash --delete-branch; then
    echo ""
    echo "✅ PR merged successfully!"
  else
    echo ""
    echo "⚠️  Merge failed. You can try manually: gh pr merge ${prNumber} --squash"
  fi` : `  echo "View PR: gh pr view ${prNumber} --web"
  echo "To merge: cis merge"`}
else
  echo "View PR: gh pr view ${prNumber} --web"
fi
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

export async function selectReviewCommand(options: { merge?: boolean } = {}): Promise<void> {
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
    await launchReviewForPR(pr, projectRoot, projectName, options);
  }

  console.log();
  console.log(chalk.green(`✅ Started ${selected.length} review session(s)!`));
  console.log(chalk.dim('   Each review is running in its own terminal window.'));
}

async function launchReviewForPR(
  pr: OpenPR,
  projectRoot: string,
  _projectName: string,
  options: { merge?: boolean } = {}
): Promise<void> {
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

**IMPORTANT: Submit only ONE review to avoid duplicate reviews on GitHub.**

${botToken ? `A bot token is configured. Use this prefix for ALL gh commands:
\`\`\`bash
GH_TOKEN=\${BOT_TOKEN} gh pr review ...
\`\`\`
The BOT_TOKEN environment variable is already set in this terminal.

Collect all your feedback and submit it in a SINGLE review command:

\`\`\`bash
# If the code looks good:
GH_TOKEN=\${BOT_TOKEN} gh pr review ${pr.number} --approve --body "LGTM! Code looks good."

# If there are issues to address:
GH_TOKEN=\${BOT_TOKEN} gh pr review ${pr.number} --request-changes --body "## Review Feedback

**File: path/to/file.ts**
Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`

**File: another/file.ts**
Another issue...
"
\`\`\`
` : `First, check if you can post formal reviews by running these commands:
\`\`\`bash
# Get PR author
PR_AUTHOR=$(gh pr view ${pr.number} --json author --jq .author.login)
# Get current user
CURRENT_USER=$(gh api user --jq .login)
echo "PR author: $PR_AUTHOR, Current user: $CURRENT_USER"
\`\`\`

### If PR author ≠ Current user (reviewing someone else's PR):
Collect all your feedback and submit it in a SINGLE review command:

\`\`\`bash
# If the code looks good:
gh pr review ${pr.number} --approve --body "LGTM! Code looks good."

# If there are issues to address:
gh pr review ${pr.number} --request-changes --body "## Review Feedback

**File: path/to/file.ts**
Description of the issue...

\\\`\\\`\\\`suggestion
// Your suggested fix here
\\\`\\\`\\\`

**File: another/file.ts**
Another issue...
"
\`\`\`

### If PR author = Current user (reviewing your own PR):
You can only post comments (GitHub doesn't allow self-review):

\`\`\`bash
gh pr comment ${pr.number} --body "## Self-Review Notes

**File: path/to/file.ts**
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

  // Write prompt and runner script to temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cis-review-'));
  const promptFile = path.join(tempDir, '.claude-review-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  const botTokenEnv = botToken ? `export BOT_TOKEN="${botToken}"\nexport GH_TOKEN="${botToken}"` : '# No bot token configured';
  const botNote = botToken
    ? 'Using bot token for reviews (can approve/request changes)'
    : 'No bot token - using your account (may have limitations on own PRs)';

  // Create runner script for review
  const runnerScript = path.join(tempDir, '.claude-review-runner.sh');
  const escapedTitle = pr.title.replace(/"/g, '\\"').slice(0, 50);
  const runnerContent = `#!/bin/bash
cd "${projectRoot}"

# Disable Oh My Zsh auto-update prompt to prevent blocking
export DISABLE_AUTO_UPDATE="true"

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
${options.merge ? 'echo "\\n🔄 Auto-merge enabled: will merge if approved."' : ''}
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run Claude interactively
claude --dangerously-skip-permissions "$(cat '${promptFile}')"

# Clean up temp files
rm -rf '${tempDir}'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Review session ended."
echo ""

# Check if PR was approved
REVIEW_STATUS=$(gh pr view ${pr.number} --json reviewDecision --jq '.reviewDecision' 2>/dev/null)

if [ "$REVIEW_STATUS" = "APPROVED" ]; then
  echo "✅ PR #${pr.number} is approved!"
  echo ""
${options.merge ? `  echo "📤 Auto-merging PR #${pr.number}..."
  if gh pr merge ${pr.number} --squash --delete-branch; then
    echo ""
    echo "✅ PR merged successfully!"
  else
    echo ""
    echo "⚠️  Merge failed. You can try manually: gh pr merge ${pr.number} --squash"
  fi` : `  echo "View PR: gh pr view ${pr.number} --web"
  echo "To merge: cis merge"`}
else
  echo "View PR: gh pr view ${pr.number} --web"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep terminal open
exec bash
`;

  fs.writeFileSync(runnerScript, runnerContent, { mode: 0o755 });

  console.log(chalk.dim(`   Starting review for PR #${pr.number}: ${pr.title.slice(0, 50)}...`));

  openInNewTerminal(`'${runnerScript}'`);
}
