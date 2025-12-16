import chalk from 'chalk';
import inquirer from 'inquirer';
import { listIssues, getIssuesWithOpenPRs } from '../utils/github';
import { getProjectName } from '../utils/git';
import { solveCommand } from './solve';

export async function selectCommand(): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const issues = listIssues();

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
  }

  // Filter out issues that already have open PRs
  const issuesWithPRs = getIssuesWithOpenPRs();
  const availableIssues = issues.filter((issue) => !issuesWithPRs.has(issue.number));

  if (availableIssues.length === 0) {
    console.log(chalk.yellow('All open issues already have PRs in progress.'));
    console.log(chalk.dim('Use `claude-issue go` to navigate to existing worktrees.'));
    return;
  }

  if (issuesWithPRs.size > 0) {
    const skipped = issues.length - availableIssues.length;
    console.log(chalk.dim(`(${skipped} issue${skipped > 1 ? 's' : ''} with open PRs hidden)\n`));
  }

  const choices = availableIssues.map((issue) => ({
    name: `#${issue.number}\t${issue.title}`,
    value: issue.number,
  }));

  choices.push({
    name: chalk.dim('Cancel'),
    value: -1,
  });

  const { issueNumber } = await inquirer.prompt([
    {
      type: 'list',
      name: 'issueNumber',
      message: 'Select an issue to solve:',
      choices,
      pageSize: 15,
    },
  ]);

  if (issueNumber === -1) {
    console.log(chalk.dim('Cancelled.'));
    return;
  }

  await solveCommand(issueNumber);
}
