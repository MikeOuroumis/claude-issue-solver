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

  const issuesWithPRs = getIssuesWithOpenPRs();

  const choices = issues.map((issue) => {
    const hasPR = issuesWithPRs.has(issue.number);
    const prTag = hasPR ? chalk.magenta(' [PR]') : '';
    return {
      name: `#${issue.number}\t${issue.title}${prTag}`,
      value: issue.number,
    };
  });

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
