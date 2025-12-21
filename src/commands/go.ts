import chalk from 'chalk';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import { getProjectRoot, getProjectName, exec } from '../utils/git';

interface Worktree {
  path: string;
  branch: string;
  issueNumber: string;
}

interface PRInfo {
  url: string;
  reviewDecision: string | null;
}

function getIssueWorktrees(): Worktree[] {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();

  const worktrees: Worktree[] = [];

  // Get all worktrees from git
  const output = exec('git worktree list --porcelain', projectRoot);
  if (!output) return worktrees;

  const lines = output.split('\n');
  let currentPath = '';
  let currentBranch = '';

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = line.replace('worktree ', '');
    } else if (line.startsWith('branch refs/heads/')) {
      currentBranch = line.replace('branch refs/heads/', '');

      // Check if this is an issue branch
      const match = currentBranch.match(/^issue-(\d+)-/);
      if (match && currentPath.includes(`${projectName}-issue-`)) {
        worktrees.push({
          path: currentPath,
          branch: currentBranch,
          issueNumber: match[1],
        });
      }
    }
  }

  return worktrees;
}

function getPRForBranch(branch: string): PRInfo | null {
  try {
    const output = execSync(`gh pr list --head "${branch}" --json url,reviewDecision --jq '.[0]'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!output || output === 'null') return null;
    const data = JSON.parse(output);
    return {
      url: data.url,
      reviewDecision: data.reviewDecision,
    };
  } catch {
    return null;
  }
}

function getReviewStatusLabel(reviewDecision: string | null): string {
  switch (reviewDecision) {
    case 'APPROVED':
      return chalk.green('✓ Approved');
    case 'CHANGES_REQUESTED':
      return chalk.red('✗ Changes requested');
    case 'REVIEW_REQUIRED':
      return chalk.yellow('○ Review required');
    default:
      return chalk.dim('○ No reviews');
  }
}

export async function goCommand(issueNumber?: number): Promise<void> {
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    console.log(chalk.dim('Run `claude-issue <number>` to start working on an issue.'));
    return;
  }

  let selectedWorktree: Worktree;

  if (issueNumber) {
    // Find specific worktree
    const found = worktrees.find((wt) => wt.issueNumber === String(issueNumber));
    if (!found) {
      console.log(chalk.red(`\n❌ No worktree found for issue #${issueNumber}`));
      console.log(chalk.dim('\nAvailable worktrees:'));
      for (const wt of worktrees) {
        console.log(chalk.dim(`  #${wt.issueNumber}: ${wt.path}`));
      }
      return;
    }
    selectedWorktree = found;
  } else {
    // Show selection with PR status
    console.log(chalk.bold('\n📂 Issue worktrees:\n'));

    // Fetch PR info for all worktrees
    const worktreesWithPR = worktrees.map((wt) => ({
      ...wt,
      prInfo: getPRForBranch(wt.branch),
    }));

    const choices = worktreesWithPR.map((wt) => {
      const statusTag = wt.prInfo
        ? getReviewStatusLabel(wt.prInfo.reviewDecision)
        : chalk.dim('No PR');
      return {
        name: `#${wt.issueNumber}\t${wt.branch}\t${statusTag}`,
        value: wt,
      };
    });

    choices.push({
      name: chalk.dim('Cancel'),
      value: null as any,
    });

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a worktree to open:',
        choices,
        pageSize: 15,
      },
    ]);

    if (!selected) {
      console.log(chalk.dim('Cancelled.'));
      return;
    }

    selectedWorktree = selected;
  }

  // Get PR info
  const prInfo = getPRForBranch(selectedWorktree.branch);

  console.log();
  console.log(chalk.bold(`📂 Issue #${selectedWorktree.issueNumber}`));
  console.log(chalk.dim(`   Path: ${selectedWorktree.path}`));
  console.log(chalk.dim(`   Branch: ${selectedWorktree.branch}`));
  if (prInfo) {
    console.log(chalk.cyan(`   PR: ${prInfo.url}`));
    console.log(`   Status: ${getReviewStatusLabel(prInfo.reviewDecision)}`);
  }
  console.log();

  // Ask what to do
  const actions: Array<{ name: string; value: string }> = [
    { name: '📁 Open in VS Code', value: 'vscode' },
    { name: '📂 Open in Finder', value: 'finder' },
    { name: '💻 Print cd command', value: 'cd' },
  ];

  if (prInfo) {
    actions.unshift({ name: '🔗 Open PR in browser', value: 'pr' });
  }

  actions.push({ name: chalk.dim('Cancel'), value: 'cancel' });

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: actions,
    },
  ]);

  switch (action) {
    case 'pr':
      console.log(chalk.dim(`\nOpening PR in browser...`));
      execSync(`open "${prInfo!.url}"`, { stdio: 'pipe' });
      break;
    case 'vscode':
      console.log(chalk.dim(`\nOpening in VS Code...`));
      execSync(`code "${selectedWorktree.path}"`, { stdio: 'pipe' });
      break;
    case 'finder':
      console.log(chalk.dim(`\nOpening in Finder...`));
      execSync(`open "${selectedWorktree.path}"`, { stdio: 'pipe' });
      break;
    case 'cd':
      console.log(chalk.dim(`\nRun this command:\n`));
      console.log(chalk.cyan(`cd "${selectedWorktree.path}"`));
      break;
    case 'cancel':
      console.log(chalk.dim('Cancelled.'));
      break;
  }
}
