import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, branchExists, getDefaultBranch } from '../utils/git';
import { slugify, copyEnvFiles, symlinkNodeModules, openInNewTerminal } from '../utils/helpers';
import { getBotToken } from './config';

export async function solveCommand(issueNumber: number, options: { auto?: boolean } = {}): Promise<void> {
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
4. When done, commit your changes with a descriptive message that references the issue`;

  // Write prompt to a file to avoid shell escaping issues with backticks, <>, etc.
  const promptFile = path.join(worktreePath, '.claude-prompt.txt');
  fs.writeFileSync(promptFile, prompt);

  // Get bot token for auto mode
  const botToken = getBotToken();
  const autoMode = options.auto || false;

  // Create runner script
  const runnerScript = path.join(worktreePath, '.claude-runner.sh');
  const runnerContent = `#!/bin/bash
cd "${worktreePath}"

# Set terminal title
echo -ne "\\033]0;Issue #${issueNumber}: ${issue.title.replace(/"/g, '\\"').slice(0, 50)}\\007"

echo "🤖 Claude Code - Issue #${issueNumber}: ${issue.title}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
${autoMode ? `echo "🔄 AUTO MODE: Fully autonomous solve → review → fix loop"
echo "   Max 3 iterations. No user input required."
${!botToken ? 'echo "⚠️  No bot token configured. Run: cis config bot-token"' : ''}` : 'echo "When Claude commits, a PR will be created automatically."'}
echo "The terminal stays open for follow-up changes."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

${botToken ? `# Bot token for reviews (only used during review, not PR creation)
export BOT_TOKEN="${botToken}"
` : ''}

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
        echo "$PR_NUM"
      fi
    else
      # PR exists, just push new commits
      git push origin "${branchName}" 2>/dev/null
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "📤 Pushed new commits to PR #$EXISTING_PR"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "$EXISTING_PR"
    fi
  fi
}

# Function to get PR number
get_pr_number() {
  gh pr list --head "${branchName}" --json number --jq '.[0].number' 2>/dev/null
}

# Function to get PR review status
get_review_status() {
  gh pr view "$1" --json reviewDecision --jq '.reviewDecision' 2>/dev/null
}

${autoMode ? `# AUTO MODE: Non-interactive solve → review → fix loop
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 STEP 1: Solving issue..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run Claude non-interactively to solve
claude -p --dangerously-skip-permissions "$(cat '${promptFile}')"

# Clean up prompt file
rm -f '${promptFile}'

# Create PR
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📤 Creating PR..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
create_pr

# Review loop
MAX_ITERATIONS=3
ITERATION=0

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))

  sleep 2
  PR_NUM=$(get_pr_number)

  if [ -z "$PR_NUM" ]; then
    echo ""
    echo "⚠️  No PR found, skipping auto-review"
    break
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔍 STEP 2: Review iteration $ITERATION of $MAX_ITERATIONS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Get PR diff for review
  PR_DIFF=$(gh pr diff $PR_NUM 2>/dev/null | head -500)

  # Write review prompt to file (avoid escaping issues)
  REVIEW_FILE=".claude-review-prompt.txt"
  cat > "$REVIEW_FILE" << 'REVIEW_EOF'
You are reviewing a PR. Your task is to review the code and leave feedback using the gh CLI.

IMPORTANT: You must run ONE of these commands before finishing:
${botToken ? `
To APPROVE (if code looks good):
GH_TOKEN=$BOT_TOKEN gh pr review PR_NUM --approve --body "LGTM! Code looks good."

To REQUEST CHANGES (if issues found):
GH_TOKEN=$BOT_TOKEN gh pr review PR_NUM --request-changes --body "Your detailed feedback here"
` : `
To APPROVE (if code looks good):
gh pr review PR_NUM --approve --body "LGTM! Code looks good."

To REQUEST CHANGES (if issues found):
gh pr review PR_NUM --request-changes --body "Your detailed feedback here"
`}
Review criteria:
1. Does the code solve the issue correctly?
2. Are there bugs or logic errors?
3. Security vulnerabilities?
4. Missing error handling?
5. Code quality issues?

REVIEW_EOF

  # Append issue and diff info
  echo "" >> "$REVIEW_FILE"
  echo "## Issue #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}" >> "$REVIEW_FILE"
  echo "${issue.body.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\`/g, '\\`')}" >> "$REVIEW_FILE"
  echo "" >> "$REVIEW_FILE"
  echo "## PR Diff:" >> "$REVIEW_FILE"
  echo "\\\`\\\`\\\`diff" >> "$REVIEW_FILE"
  echo "$PR_DIFF" >> "$REVIEW_FILE"
  echo "\\\`\\\`\\\`" >> "$REVIEW_FILE"

  # Replace PR_NUM placeholder
  sed -i '' "s/PR_NUM/$PR_NUM/g" "$REVIEW_FILE" 2>/dev/null || sed -i "s/PR_NUM/$PR_NUM/g" "$REVIEW_FILE"

  # Run Claude for review (non-interactive)
  claude -p --dangerously-skip-permissions "$(cat "$REVIEW_FILE")"
  rm -f "$REVIEW_FILE"

  # Check review status
  sleep 2
  REVIEW_STATUS=$(get_review_status $PR_NUM)

  echo ""
  echo "📊 Review status: $REVIEW_STATUS"

  if [ "$REVIEW_STATUS" = "APPROVED" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ PR APPROVED! Ready to merge."
    echo "   Run: cis merge"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    break
  elif [ "$REVIEW_STATUS" = "CHANGES_REQUESTED" ]; then
    if [ $ITERATION -lt $MAX_ITERATIONS ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "🔧 STEP 3: Fixing requested changes..."
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""

      # Get the review comments
      REVIEW_COMMENTS=$(gh pr view $PR_NUM --json reviews --jq '.reviews[-1].body' 2>/dev/null)

      # Write fix prompt to file
      FIX_FILE=".claude-fix-prompt.txt"
      cat > "$FIX_FILE" << FIX_EOF
The code review requested changes. Please fix them and commit.

## Review Feedback
$REVIEW_COMMENTS

Please address the feedback above, make the necessary changes, and commit them.
FIX_EOF

      # Run Claude to fix (non-interactive)
      claude -p --dangerously-skip-permissions "$(cat "$FIX_FILE")"
      rm -f "$FIX_FILE"

      # Push changes
      git push origin "${branchName}" 2>/dev/null
      sleep 2
    else
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "⚠️  Max iterations reached. Manual review needed."
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
  else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "ℹ️  Review status: $REVIEW_STATUS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    break
  fi
done
` : `# INTERACTIVE MODE: Watch for commits and create PR automatically
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
create_pr > /dev/null
`}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Claude session ended. Terminal staying open."
echo "To clean up after merge: claude-issue clean ${issueNumber}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep terminal open
exec bash
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
