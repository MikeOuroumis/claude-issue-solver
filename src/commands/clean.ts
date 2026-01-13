import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssueStatus, getPRForBranch, getIssueStatusAsync, getPRForBranchAsync, IssueStatus, PRStatus } from '../utils/github';
import { getProjectRoot, getProjectName, exec } from '../utils/git';
import { slugify } from '../utils/helpers';
import { closeWindowsForWorktree } from '../utils/terminal';

interface Worktree {
  path: string;
  branch: string;
  issueNumber: string;
}

interface WorktreeWithStatus extends Worktree {
  issueStatus: IssueStatus | null;
  prStatus: PRStatus | null;
}

function getStatusLabel(wt: WorktreeWithStatus): string {
  if (!wt.branch) {
    return chalk.yellow('(orphaned folder)');
  }

  if (wt.prStatus) {
    switch (wt.prStatus.state) {
      case 'merged':
        return chalk.green('✓ PR merged');
      case 'open':
        return chalk.blue('◐ PR open');
      case 'closed':
        return chalk.red('✗ PR closed');
    }
  }

  if (wt.issueStatus) {
    switch (wt.issueStatus.state) {
      case 'closed':
        return chalk.dim('● Issue closed');
      case 'open':
        return chalk.cyan('○ Issue open');
    }
  }

  return chalk.dim('? Unknown');
}

function getIssueWorktrees(): Worktree[] {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const parentDir = path.dirname(projectRoot);

  const worktrees: Worktree[] = [];
  const foundPaths = new Set<string>();

  // Get all worktrees from git
  const output = exec('git worktree list --porcelain', projectRoot);
  if (output) {
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
          foundPaths.add(currentPath);
        }
      }
    }
  }

  // Also check for orphaned folders (folders that exist but aren't in git worktree list)
  // This can happen when git worktree remove fails but the folder remains
  try {
    const folderPattern = `${projectName}-issue-`;
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(folderPattern)) {
        const folderPath = path.join(parentDir, entry.name);
        if (!foundPaths.has(folderPath)) {
          // Extract issue number from folder name (e.g., "project-issue-38-slug")
          const match = entry.name.match(new RegExp(`${projectName}-issue-(\\d+)-`));
          if (match) {
            worktrees.push({
              path: folderPath,
              branch: '', // No branch known for orphaned folders
              issueNumber: match[1],
            });
          }
        }
      }
    }
  } catch {
    // Ignore errors reading parent directory
  }

  return worktrees;
}

export async function cleanAllCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const currentDir = process.cwd();
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    return;
  }

  // Warn if user is inside a worktree that might be deleted
  const inWorktree = worktrees.find((wt) => currentDir.startsWith(wt.path));
  if (inWorktree) {
    console.log(chalk.yellow(`\n⚠️  You are inside worktree #${inWorktree.issueNumber}`));
    console.log(chalk.yellow(`   Run this command from the main project directory for best results.`));
    console.log(chalk.dim(`   cd ${projectRoot}\n`));
  }

  // Fetch status for all worktrees in parallel
  const statusSpinner = ora('Fetching issue and PR status...').start();
  const worktreesWithStatus: WorktreeWithStatus[] = await Promise.all(
    worktrees.map(async (wt) => ({
      ...wt,
      issueStatus: await getIssueStatusAsync(parseInt(wt.issueNumber, 10)),
      prStatus: wt.branch ? await getPRForBranchAsync(wt.branch) : null,
    }))
  );
  statusSpinner.stop();

  console.log(chalk.bold('\n🧹 Found issue worktrees:\n'));

  // Build choices for checkbox prompt
  const choices = worktreesWithStatus.map((wt) => {
    const status = getStatusLabel(wt);
    const isMerged = wt.prStatus?.state === 'merged';
    return {
      name: `#${wt.issueNumber}\t${status}`,
      value: wt.issueNumber,
      checked: isMerged, // Pre-select merged PRs
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select worktrees to clean (space to toggle, enter to confirm):',
      choices,
    },
  ]);

  if (selected.length === 0) {
    console.log(chalk.dim('No worktrees selected.'));
    return;
  }

  // Filter to only selected worktrees
  const selectedWorktrees = worktrees.filter((wt) => selected.includes(wt.issueNumber));

  console.log();

  for (const wt of selectedWorktrees) {
    const spinner = ora(`Cleaning issue #${wt.issueNumber}...`).start();

    try {
      // Close terminal and VS Code windows for this worktree
      // Get PR number for this worktree if available
      const wtStatus = worktreesWithStatus.find((w) => w.issueNumber === wt.issueNumber);
      const prNum = wtStatus?.prStatus?.number?.toString();
      closeWindowsForWorktree({
        folderPath: wt.path,
        issueNumber: wt.issueNumber,
        prNumber: prNum,
      });
      // Give windows time to close before removing folder
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Remove worktree/folder
      const isOrphaned = !wt.branch;

      // Try git worktree remove first (only if not orphaned)
      if (!isOrphaned && fs.existsSync(wt.path)) {
        try {
          execSync(`git worktree remove "${wt.path}" --force`, {
            cwd: projectRoot,
            stdio: 'pipe',
          });
        } catch {
          // Ignore - we'll force delete below
        }
      }

      // Always try to force delete the folder
      if (fs.existsSync(wt.path)) {
        // Try multiple deletion methods
        try {
          execSync(`/bin/rm -rf "${wt.path}"`, { stdio: 'pipe', timeout: 10000 });
        } catch {
          // Fallback 1: try with shell
          try {
            execSync(`rm -rf "${wt.path}"`, { shell: '/bin/bash', stdio: 'pipe', timeout: 10000 });
          } catch {
            // Fallback 2: Node.js rmSync
            try {
              fs.rmSync(wt.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch {
              // Will report failure below
            }
          }
        }
      }

      // Prune git worktrees
      try {
        execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        // Ignore
      }

      // Delete branch (if we have one)
      if (wt.branch) {
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd: projectRoot,
            stdio: 'pipe',
          });
        } catch {
          // Branch may already be deleted
        }
      }

      // Check if cleanup was successful
      if (fs.existsSync(wt.path)) {
        spinner.warn(`Cleaned issue #${wt.issueNumber} (folder may remain: ${wt.path})`);
      } else {
        spinner.succeed(`Cleaned issue #${wt.issueNumber}`);
      }
    } catch (error) {
      spinner.fail(`Failed to clean issue #${wt.issueNumber}: ${error}`);
    }
  }

  // Prune stale worktrees
  execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });

  console.log();
  console.log(chalk.green(`✅ Cleaned up ${selectedWorktrees.length} issue worktree(s)!`));
}

export async function cleanCommand(issueNumber: number): Promise<void> {
  const projectRoot = getProjectRoot();
  const projectName = getProjectName();
  const parentDir = path.dirname(projectRoot);

  // Find the worktree for this issue number (don't need to fetch from GitHub)
  // This now also includes orphaned folders
  const worktrees = getIssueWorktrees();
  const worktree = worktrees.find((wt) => wt.issueNumber === String(issueNumber));

  if (!worktree) {
    // Try to find by looking for the branch pattern
    const branchPattern = `issue-${issueNumber}-`;
    const output = exec('git branch', projectRoot);
    const branches = output.split('\n').map((b) => b.trim().replace('* ', ''));
    const matchingBranch = branches.find((b) => b.startsWith(branchPattern));

    if (!matchingBranch) {
      console.log(chalk.red(`\n❌ No worktree, folder, or branch found for issue #${issueNumber}`));
      return;
    }

    // Found a branch but no worktree - just delete the branch
    console.log(chalk.bold(`\n🧹 Cleaning up issue #${issueNumber}`));
    console.log(chalk.dim(`   Branch: ${matchingBranch}`));
    console.log(chalk.dim(`   (No worktree found)`));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Delete branch?',
        default: false,
      },
    ]);

    if (confirm) {
      try {
        execSync(`git branch -D "${matchingBranch}"`, { cwd: projectRoot, stdio: 'pipe' });
        console.log(chalk.green('\n✅ Branch deleted!'));
      } catch {
        console.log(chalk.yellow('\n⚠️  Could not delete branch'));
      }
    }
    return;
  }

  const branchName = worktree.branch;
  const worktreePath = worktree.path;
  const isOrphaned = !branchName;

  // Fetch status
  const statusSpinner = ora('Fetching issue and PR status...').start();
  const issueStatus = getIssueStatus(issueNumber);
  const prStatus = branchName ? getPRForBranch(branchName) : null;
  statusSpinner.stop();

  const wtWithStatus: WorktreeWithStatus = {
    ...worktree,
    issueStatus,
    prStatus,
  };
  const status = getStatusLabel(wtWithStatus);

  console.log();
  console.log(chalk.bold(`🧹 Cleaning up issue #${issueNumber}`));
  console.log(`   Status: ${status}`);
  if (!isOrphaned) {
    console.log(chalk.dim(`   Branch: ${branchName}`));
  }
  console.log(chalk.dim(`   Folder: ${worktreePath}`));
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: isOrphaned ? 'Remove orphaned folder?' : 'Remove worktree and delete branch?',
      default: false,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  // Close terminal and VS Code windows for this worktree
  const windowSpinner = ora('Closing terminal and VS Code windows...').start();
  const prNum = prStatus?.number?.toString();
  const closeResult = closeWindowsForWorktree({
    folderPath: worktreePath,
    issueNumber: String(issueNumber),
    prNumber: prNum,
  });
  // Give windows time to close before removing folder
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (closeResult.iTerm || closeResult.terminal || closeResult.vscode) {
    windowSpinner.succeed('Windows closed');
  } else {
    windowSpinner.info('No matching windows found');
  }

  // Remove worktree/folder
  if (fs.existsSync(worktreePath)) {
    const worktreeSpinner = ora('Removing worktree...').start();

    // Try git worktree remove first (only if not orphaned)
    if (!isOrphaned) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: projectRoot,
          stdio: 'pipe',
        });
      } catch {
        // Ignore - we'll force delete below if needed
      }
    }

    // If folder still exists, force delete it
    if (fs.existsSync(worktreePath)) {
      try {
        // Use rm -rf with full path
        execSync(`/bin/rm -rf "${worktreePath}"`, { stdio: 'pipe' });
      } catch {
        // Try Node's rmSync as fallback
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch {
          // Last resort - try with sudo hint
          worktreeSpinner.warn(`Could not remove directory. Try manually: rm -rf "${worktreePath}"`);
        }
      }
    }

    // Prune git worktrees
    try {
      execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      // Ignore
    }

    // Check final result
    if (fs.existsSync(worktreePath)) {
      worktreeSpinner.warn(`Could not fully remove directory: ${worktreePath}`);
    } else {
      worktreeSpinner.succeed(isOrphaned ? 'Folder removed' : 'Worktree removed');
    }
  }

  // Delete branch (if we have one)
  if (branchName) {
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
  }

  console.log();
  console.log(chalk.green('✅ Cleanup complete!'));
}

export async function cleanMergedCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const currentDir = process.cwd();
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    return;
  }

  // Warn if user is inside a worktree that might be deleted
  const inWorktree = worktrees.find((wt) => currentDir.startsWith(wt.path));
  if (inWorktree) {
    console.log(chalk.yellow(`\n⚠️  You are inside worktree #${inWorktree.issueNumber}`));
    console.log(chalk.yellow(`   Run this command from the main project directory for best results.`));
    console.log(chalk.dim(`   cd ${projectRoot}\n`));
  }

  // Fetch status for all worktrees in parallel
  const statusSpinner = ora('Fetching PR status...').start();
  const worktreesWithStatus: WorktreeWithStatus[] = await Promise.all(
    worktrees.map(async (wt) => ({
      ...wt,
      issueStatus: await getIssueStatusAsync(parseInt(wt.issueNumber, 10)),
      prStatus: wt.branch ? await getPRForBranchAsync(wt.branch) : null,
    }))
  );
  statusSpinner.stop();

  // Filter to merged PRs and orphaned folders
  const mergedWorktrees = worktreesWithStatus.filter(
    (wt) => wt.prStatus?.state === 'merged'
  );
  const orphanedWorktrees = worktreesWithStatus.filter(
    (wt) => !wt.branch
  );
  const toClean = [...mergedWorktrees, ...orphanedWorktrees];

  if (toClean.length === 0) {
    console.log(chalk.yellow('\nNo worktrees with merged PRs or orphaned folders found.'));

    // Show what's available
    if (worktreesWithStatus.length > 0) {
      console.log(chalk.dim('\nExisting worktrees:'));
      for (const wt of worktreesWithStatus) {
        const status = getStatusLabel(wt);
        console.log(`  ${chalk.cyan(`#${wt.issueNumber}`)}\t${status}`);
      }
    }
    return;
  }

  console.log(chalk.bold(`\n🧹 Cleaning ${toClean.length} worktree(s):\n`));

  for (const wt of toClean) {
    const status = getStatusLabel(wt);
    console.log(`  ${chalk.cyan(`#${wt.issueNumber}`)}\t${status}`);
    if (wt.branch) {
      console.log(chalk.dim(`  \t${wt.branch}`));
    }
  }

  console.log();

  for (const wt of toClean) {
    const spinner = ora(`Cleaning issue #${wt.issueNumber}...`).start();

    try {
      // Close terminal and VS Code windows for this worktree
      const prNum = wt.prStatus?.number?.toString();
      closeWindowsForWorktree({
        folderPath: wt.path,
        issueNumber: wt.issueNumber,
        prNumber: prNum,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Remove worktree/folder
      const isOrphaned = !wt.branch;

      // Try git worktree remove first (only if not orphaned)
      if (!isOrphaned && fs.existsSync(wt.path)) {
        try {
          execSync(`git worktree remove "${wt.path}" --force`, {
            cwd: projectRoot,
            stdio: 'pipe',
          });
        } catch {
          // Ignore - we'll force delete below
        }
      }

      // Always try to force delete the folder
      if (fs.existsSync(wt.path)) {
        try {
          execSync(`/bin/rm -rf "${wt.path}"`, { stdio: 'pipe', timeout: 10000 });
        } catch {
          try {
            execSync(`rm -rf "${wt.path}"`, { shell: '/bin/bash', stdio: 'pipe', timeout: 10000 });
          } catch {
            try {
              fs.rmSync(wt.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            } catch {
              // Will report failure below
            }
          }
        }
      }

      // Prune git worktrees
      try {
        execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        // Ignore
      }

      // Delete branch (if we have one)
      if (wt.branch) {
        try {
          execSync(`git branch -D "${wt.branch}"`, {
            cwd: projectRoot,
            stdio: 'pipe',
          });
        } catch {
          // Branch may already be deleted
        }
      }

      // Check if cleanup was successful
      if (fs.existsSync(wt.path)) {
        spinner.warn(`Cleaned issue #${wt.issueNumber} (folder may remain: ${wt.path})`);
      } else {
        spinner.succeed(`Cleaned issue #${wt.issueNumber}`);
      }
    } catch (error) {
      spinner.fail(`Failed to clean issue #${wt.issueNumber}: ${error}`);
    }
  }

  // Prune stale worktrees
  try {
    execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
  } catch {
    // May fail if current directory was deleted
  }

  console.log();
  console.log(chalk.green(`✅ Cleaned up ${toClean.length} worktree(s)!`));
}
