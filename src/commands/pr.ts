import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getIssue } from '../utils/github';
import { getProjectRoot, getProjectName, getCommitCount, getCommitList, getDefaultBranch } from '../utils/git';
import { slugify } from '../utils/helpers';

export async function prCommand(issueNumber: number): Promise<void> {
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

  if (!fs.existsSync(worktreePath)) {
    console.log(chalk.red(`\n❌ Worktree not found at ${worktreePath}`));
    console.log(chalk.dim(`   Make sure you've run: claude-issue ${issueNumber}`));
    process.exit(1);
  }

  const commits = getCommitCount(worktreePath);

  if (commits === 0) {
    console.log(chalk.yellow(`\n⚠️  No commits found on branch ${branchName}`));
    console.log(chalk.dim(`   Make sure Claude has committed changes before creating a PR.`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold(`📋 Issue #${issueNumber}: ${issue.title}`));
  console.log(chalk.dim(`🌿 Branch: ${branchName}`));
  console.log(chalk.dim(`📝 Commits: ${commits}`));
  console.log();

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Create PR to close issue #${issueNumber}?`,
      default: true,
    },
  ]);

  if (!confirm) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  const pushSpinner = ora('Pushing branch and creating PR...').start();

  try {
    execSync(`git push -u origin "${branchName}"`, {
      cwd: worktreePath,
      stdio: 'pipe',
    });

    const commitList = getCommitList(worktreePath);

    const prBody = `## Summary

Closes #${issueNumber}

## Changes

${commitList}

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

    const baseBranch = getDefaultBranch();
    const prUrl = execSync(
      `gh pr create --title "Fix #${issueNumber}: ${issue.title.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --head "${branchName}" --base ${baseBranch}`,
      { cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    pushSpinner.succeed('PR created!');

    console.log();
    console.log(chalk.green(`✅ PR created: ${prUrl}`));
    console.log();
    console.log(chalk.dim(`The PR will automatically close issue #${issueNumber} when merged.`));
    console.log(chalk.dim(`To clean up after merge: claude-issue clean ${issueNumber}`));
  } catch (error) {
    pushSpinner.fail('Failed to create PR');
    console.error(error);
    process.exit(1);
  }
}
