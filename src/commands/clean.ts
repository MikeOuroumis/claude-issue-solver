import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getIssueStatus, getPRForBranch, IssueStatus, PRStatus } from '../utils/github';
import { getProjectRoot, getProjectName, exec } from '../utils/git';
import { slugify } from '../utils/helpers';

function closeWindowsWithPath(folderPath: string, issueNumber: string): void {
  if (os.platform() !== 'darwin') return;

  const folderName = path.basename(folderPath);
  const issuePattern = `Issue #${issueNumber}`;

  // Try to close iTerm2 tabs/windows with this path or issue number
  try {
    execSync(`osascript -e '
      tell application "iTerm"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              set sessionName to name of s
              if sessionName contains "${folderName}" or sessionName contains "${issuePattern}" then
                close s
              end if
            end repeat
          end repeat
        end repeat
      end tell
    '`, { stdio: 'pipe' });
  } catch {
    // iTerm not running or no matching sessions
  }

  // Try to close Terminal.app windows with this path or issue number
  try {
    execSync(`osascript -e '
      tell application "Terminal"
        repeat with w in windows
          set windowName to name of w
          if windowName contains "${folderName}" or windowName contains "${issuePattern}" then
            close w
          end if
        end repeat
      end tell
    '`, { stdio: 'pipe' });
  } catch {
    // Terminal not running or no matching windows
  }

  // Try to close VS Code windows with this path
  // Method 1: AppleScript to close windows matching the folder name
  try {
    execSync(`osascript -e '
      tell application "System Events"
        if exists process "Code" then
          tell process "Code"
            set windowList to every window
            repeat with w in windowList
              try
                set windowName to name of w
                if windowName contains "${folderName}" then
                  perform action "AXPress" of (first button of w whose subrole is "AXCloseButton")
                  delay 0.2
                end if
              end try
            end repeat
          end tell
        end if
      end tell
    '`, { stdio: 'pipe', timeout: 5000 });
  } catch {
    // VS Code not running or no matching windows
  }

  // Method 2: Also try matching the issue number in window title
  try {
    execSync(`osascript -e '
      tell application "System Events"
        if exists process "Code" then
          tell process "Code"
            set windowList to every window
            repeat with w in windowList
              try
                set windowName to name of w
                if windowName contains "${issuePattern}" then
                  perform action "AXPress" of (first button of w whose subrole is "AXCloseButton")
                  delay 0.2
                end if
              end try
            end repeat
          end tell
        end if
      end tell
    '`, { stdio: 'pipe', timeout: 5000 });
  } catch {
    // VS Code not running or no matching windows
  }
}

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
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    return;
  }

  // Fetch status for all worktrees
  const statusSpinner = ora('Fetching issue and PR status...').start();
  const worktreesWithStatus: WorktreeWithStatus[] = worktrees.map((wt) => ({
    ...wt,
    issueStatus: getIssueStatus(parseInt(wt.issueNumber, 10)),
    prStatus: wt.branch ? getPRForBranch(wt.branch) : null,
  }));
  statusSpinner.stop();

  console.log(chalk.bold('\n🧹 Found issue worktrees:\n'));

  for (const wt of worktreesWithStatus) {
    const status = getStatusLabel(wt);
    console.log(`  ${chalk.cyan(`#${wt.issueNumber}`)}\t${status}`);
    if (wt.branch) {
      console.log(chalk.dim(`  \t${wt.branch}`));
    }
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
      // Close terminal and VS Code windows for this worktree
      try {
        closeWindowsWithPath(wt.path, wt.issueNumber);
        // Give windows time to close before removing folder
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Ignore errors closing windows
      }

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
  console.log(chalk.green(`✅ Cleaned up ${worktrees.length} issue worktree(s)!`));
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
  try {
    closeWindowsWithPath(worktreePath, String(issueNumber));
    // Give windows time to close before removing folder
    await new Promise((resolve) => setTimeout(resolve, 500));
    windowSpinner.succeed('Windows closed');
  } catch {
    windowSpinner.warn('Could not close some windows');
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
  const worktrees = getIssueWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow('\nNo issue worktrees found.'));
    return;
  }

  // Fetch status for all worktrees
  const statusSpinner = ora('Fetching PR status...').start();
  const worktreesWithStatus: WorktreeWithStatus[] = worktrees.map((wt) => ({
    ...wt,
    issueStatus: getIssueStatus(parseInt(wt.issueNumber, 10)),
    prStatus: wt.branch ? getPRForBranch(wt.branch) : null,
  }));
  statusSpinner.stop();

  // Filter to only merged PRs
  const mergedWorktrees = worktreesWithStatus.filter(
    (wt) => wt.prStatus?.state === 'merged'
  );

  if (mergedWorktrees.length === 0) {
    console.log(chalk.yellow('\nNo worktrees with merged PRs found.'));

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

  console.log(chalk.bold(`\n🧹 Cleaning ${mergedWorktrees.length} worktree(s) with merged PRs:\n`));

  for (const wt of mergedWorktrees) {
    console.log(`  ${chalk.cyan(`#${wt.issueNumber}`)}\t${chalk.green('✓ PR merged')}`);
    if (wt.branch) {
      console.log(chalk.dim(`  \t${wt.branch}`));
    }
  }

  console.log();

  for (const wt of mergedWorktrees) {
    const spinner = ora(`Cleaning issue #${wt.issueNumber}...`).start();

    try {
      // Close terminal and VS Code windows for this worktree
      try {
        closeWindowsWithPath(wt.path, wt.issueNumber);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        // Ignore errors closing windows
      }

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
  execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });

  console.log();
  console.log(chalk.green(`✅ Cleaned up ${mergedWorktrees.length} merged worktree(s)!`));
}
