import chalk from 'chalk';
import inquirer from 'inquirer';
import { listIssues, getIssuesWithOpenPRs } from '../utils/github';
import { getProjectName } from '../utils/git';
import { solveCommand, SolveOptions } from './solve';

export interface SelectOptions extends SolveOptions {
  limit?: number;
  all?: boolean;
}

export async function selectCommand(options: SelectOptions = {}): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const limit = options.all ? 0 : (options.limit ?? 50);
  const issues = listIssues(limit);

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
  }

  // Show hint if we hit the default limit and user didn't explicitly set options
  const defaultLimit = 50;
  const hitLimit = !options.all && !options.limit && issues.length === defaultLimit;
  if (hitLimit) {
    console.log(chalk.dim(`  Showing first ${defaultLimit} issues. Use --limit <n> or --all to see more.\n`));
  }

  const issuesWithPRs = getIssuesWithOpenPRs();

  const choices = issues.map((issue) => {
    const hasPR = issuesWithPRs.has(issue.number);
    const prTag = hasPR ? chalk.magenta(' [PR]') : '';
    const labels = issue.labels.length > 0
      ? ' ' + issue.labels.map(l => chalk.hex(`#${l.color}`).bold(`[${l.name}]`)).join(' ')
      : '';
    return {
      name: `#${issue.number}\t${issue.title}${prTag}${labels}`,
      value: issue.number,
    };
  });

  const { issueNumbers } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'issueNumbers',
      message: 'Select issues to solve (space to select, enter to confirm):',
      choices,
      pageSize: 15,
    },
  ]);

  if (issueNumbers.length === 0) {
    console.log(chalk.dim('No issues selected.'));
    return;
  }

  console.log(chalk.cyan(`\nStarting ${issueNumbers.length} issue(s)...\n`));

  for (const issueNumber of issueNumbers) {
    await solveCommand(issueNumber, options);
    console.log();
  }
}
