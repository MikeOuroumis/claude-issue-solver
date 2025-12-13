import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName } from '../utils/git';
import { slugify } from '../utils/helpers';

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
