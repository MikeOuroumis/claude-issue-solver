import chalk from 'chalk';
import inquirer from 'inquirer';
import { listIssues, getIssuesWithOpenPRs } from '../utils/github';
import { getProjectName } from '../utils/git';
import { solveCommand } from './solve';

export async function selectCommand(options: { auto?: boolean } = {}): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const issues = listIssues();

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
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

  console.log(chalk.cyan(`\nStarting ${issueNumbers.length} issue(s)${options.auto ? ' in auto mode' : ''}...\n`));

  for (const issueNumber of issueNumbers) {
    await solveCommand(issueNumber, { auto: options.auto });
    console.log();
  }
}
