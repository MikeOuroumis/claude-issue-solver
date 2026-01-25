import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getProjectRoot, getProjectName } from '../utils/git';
import { closeWindowsForWorktree } from '../utils/terminal';

interface OpenPR {
  number: number;
  title: string;
  headRefName: string;
  issueNumber: number | null;
  reviewDecision: string | null;
  mergeable: string;
}

function getOpenPRs(projectRoot: string): OpenPR[] {
  try {
    const output = execSync(
      'gh pr list --state open --json number,title,headRefName,reviewDecision,mergeable --limit 50',
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const prs = JSON.parse(output) as OpenPR[];

    return prs.map((pr) => {
      const match = pr.headRefName.match(/^issue-(\d+)-/);
      return {
        ...pr,
        issueNumber: match ? parseInt(match[1], 10) : null,
      };
    });
  } catch {
    return [];
  }
}

function cleanupWorktree(projectRoot: string, branchName: string, issueNumber: string | null, prNumber?: string): void {
  const projectName = getProjectName();
  const parentDir = path.dirname(projectRoot);
  const worktreePath = path.join(parentDir, `${projectName}-${branchName}`);

  // Close windows (including review terminals)
  if (issueNumber) {
    try {
      closeWindowsForWorktree({
        folderPath: worktreePath,
        issueNumber,
        prNumber,
      });
    } catch {
      // Ignore
    }
  }

  // Remove worktree
  if (fs.existsSync(worktreePath)) {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    } catch {
      // Try force delete
      try {
        execSync(`/bin/rm -rf "${worktreePath}"`, { stdio: 'pipe', timeout: 10000 });
      } catch {
        // Ignore
      }
    }
  }

  // Prune worktrees
  try {
    execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // Ignore
  }

  // Delete local branch
  try {
    execSync(`git branch -D "${branchName}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // Branch may not exist locally
  }
}

export async function mergeCommand(): Promise<void> {
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

  // Build choices with status
  const choices = prs.map((pr) => {
    const issueTag = pr.issueNumber ? chalk.dim(` (issue #${pr.issueNumber})`) : '';

    let statusTag = '';
    let canMerge = false;

    switch (pr.reviewDecision) {
      case 'APPROVED':
        statusTag = chalk.green(' ✓ Approved');
        canMerge = pr.mergeable === 'MERGEABLE';
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

    if (pr.mergeable === 'CONFLICTING') {
      statusTag += chalk.red(' ⚠ Conflicts');
    }

    return {
      name: `#${pr.number}\t${pr.title}${issueTag}${statusTag}`,
      value: pr,
      checked: canMerge, // Pre-select approved & mergeable PRs
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select PRs to merge and clean up (space to toggle, enter to confirm):',
      choices,
    },
  ]);

  if (selected.length === 0) {
    console.log(chalk.dim('No PRs selected.'));
    return;
  }

  console.log();

  // Confirm merge
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Merge ${selected.length} PR(s) and clean up worktrees?`,
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  console.log();

  let merged = 0;
  let failed = 0;

  for (const pr of selected as OpenPR[]) {
    const prSpinner = ora(`Merging PR #${pr.number}...`).start();

    try {
      // Clean up worktree FIRST (before merge) to avoid branch deletion issues
      try {
        cleanupWorktree(projectRoot, pr.headRefName, pr.issueNumber?.toString() || null, pr.number.toString());
      } catch {
        // Worktree may not exist, continue with merge
      }

      // Merge the PR
      execSync(`gh pr merge ${pr.number} --squash --delete-branch`, {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      prSpinner.succeed(`Merged PR #${pr.number}: ${pr.title.slice(0, 50)}`);
      merged++;
    } catch (error: any) {
      const errorMsg = error.stderr?.toString() || error.message || 'Unknown error';
      prSpinner.fail(`Failed to merge PR #${pr.number}: ${errorMsg.split('\n')[0]}`);
      failed++;
    }
  }

  console.log();
  if (merged > 0) {
    console.log(chalk.green(`✅ Merged ${merged} PR(s)!`));
  }
  if (failed > 0) {
    console.log(chalk.yellow(`⚠️  ${failed} PR(s) could not be merged.`));
  }
}
