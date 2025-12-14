import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, exec } from '../utils/git';
import { slugify } from '../utils/helpers';

function closeWindowsWithPath(folderPath: string): void {
  if (os.platform() !== 'darwin') return;

  const folderName = path.basename(folderPath);

  // Try to close iTerm2 tabs/windows with this path
  try {
    execSync(`osascript -e '
      tell application "iTerm"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              set sessionName to name of s
              if sessionName contains "${folderName}" then
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

  // Try to close Terminal.app windows with this path
  try {
    execSync(`osascript -e '
      tell application "Terminal"
        repeat with w in windows
          if name of w contains "${folderName}" then
            close w
          end if
        end repeat
      end tell
    '`, { stdio: 'pipe' });
  } catch {
    // Terminal not running or no matching windows
  }

  // Try to close VS Code windows with this path
  try {
    execSync(`osascript -e '
      tell application "System Events"
        if exists process "Code" then
          tell process "Code"
            set windowList to every window
            repeat with w in windowList
              set windowName to name of w
              if windowName contains "${folderName}" then
                perform action "AXPress" of (first button of w whose subrole is "AXCloseButton")
              end if
            end repeat
          end tell
        end if
      end tell
    '`, { stdio: 'pipe' });
  } catch {
    // VS Code not running or no matching windows
  }
}

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
      // Close terminal and VS Code windows for this worktree
      try {
        closeWindowsWithPath(wt.path);
      } catch {
        // Ignore errors closing windows
      }

      // Remove worktree
      if (fs.existsSync(wt.path)) {
        try {
          execSync(`git worktree remove "${wt.path}" --force`, {
            cwd: projectRoot,
            stdio: 'pipe',
          });
        } catch {
          // If git worktree remove fails, try removing directory manually
          fs.rmSync(wt.path, { recursive: true, force: true });
          execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
        }
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

  // Find the worktree for this issue number (don't need to fetch from GitHub)
  const worktrees = getIssueWorktrees();
  const worktree = worktrees.find((wt) => wt.issueNumber === String(issueNumber));

  if (!worktree) {
    // Try to find by looking for the branch pattern
    const branchPattern = `issue-${issueNumber}-`;
    const output = exec('git branch', projectRoot);
    const branches = output.split('\n').map((b) => b.trim().replace('* ', ''));
    const matchingBranch = branches.find((b) => b.startsWith(branchPattern));

    if (!matchingBranch) {
      console.log(chalk.red(`\n❌ No worktree or branch found for issue #${issueNumber}`));
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

  // Close terminal and VS Code windows for this worktree
  try {
    closeWindowsWithPath(worktreePath);
  } catch {
    // Ignore errors closing windows
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
      // If git worktree remove fails, try removing directory manually
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        execSync('git worktree prune', { cwd: projectRoot, stdio: 'pipe' });
        worktreeSpinner.succeed('Worktree removed (manually)');
      } catch {
        worktreeSpinner.warn('Could not remove worktree directory');
      }
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
