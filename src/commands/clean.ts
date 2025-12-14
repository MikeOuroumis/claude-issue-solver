import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, exec } from '../utils/git';
import { slugify } from '../utils/helpers';

interface Worktree {
  path: string;
  branch: string;
  issueNumber: string;
}

function getIssueWorktrees(): Worktree[] {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const parentDir = path.dirname(projectRoot);

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

export async function cleanAllCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    return;
  }

  console.log(chalk.bold('\n🧹 Found issue worktrees:\n'));

  for (const wt of worktrees) {
    console.log(`  ${chalk.cyan(`#${wt.issueNumber}`)}\t${wt.branch}`);
    console.log(chalk.dim(`  \t${wt.path}`));
    console.log();
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove all ${worktrees.length} worktree(s) and delete branches?`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  console.log();

  for (const wt of worktrees) {
    const spinner = ora(`Cleaning issue #${wt.issueNumber}...`).start();

    try {
      // Remove worktree
      if (fs.existsSync(wt.path)) {
        execSync(`git worktree remove "${wt.path}" --force`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      }

      // Delete branch
      try {
        execSync(`git branch -D "${wt.branch}"`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } catch {
        // Branch may already be deleted
      }

      spinner.succeed(`Cleaned issue #${wt.issueNumber}`);
    } catch (error) {
      spinner.fail(`Failed to clean issue #${wt.issueNumber}`);
    }
  }

  // Prune stale worktrees
  execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });

  console.log();
  console.log(chalk.green(`✅ Cleaned up ${worktrees.length} issue worktree(s)!`));
}

export async function cleanCommand(issueNumber: number): Promise<void> {
  const spinner = ora(`Fetching issue #${issueNumber}...`).start();

  const issue = getIssue(issueNumber);
  if (!issue) {
    spinner.fail(`Could not find issue #${issueNumber}`);
    process.exit(1);
  }

  spinner.succeed(`Found issue #${issueNumber}`);

  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const branchSlug = slugify(issue.title);
  const branchName = `issue-${issueNumber}-${branchSlug}`;
  const worktreePath = path.join(path.dirname(projectRoot), `${projectName}-${branchName}`);

  console.log();
  console.log(chalk.bold(`🧹 Cleaning up issue #${issueNumber}`));
  console.log(chalk.dim(`   Branch: ${branchName}`));
  console.log(chalk.dim(`   Worktree: ${worktreePath}`));
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Remove worktree and delete branch?',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  // Remove worktree
  if (fs.existsSync(worktreePath)) {
    const worktreeSpinner = ora('Removing worktree...').start();
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: projectRoot,
        stdio: 'pipe',
      });
      worktreeSpinner.succeed('Worktree removed');
    } catch {
      worktreeSpinner.warn('Could not remove worktree (may already be removed)');
    }
  }

  // Delete branch
  const branchSpinner = ora('Deleting branch...').start();
  try {
    execSync(`git branch -D "${branchName}"`, {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    branchSpinner.succeed('Branch deleted');
  } catch {
    branchSpinner.warn('Could not delete branch (may already be deleted)');
  }

  console.log();
  console.log(chalk.green('✅ Cleanup complete!'));
}
