import chalk from 'chalk';
import { getIssue } from '../utils/github';

export async function showCommand(issueNumber: number): Promise<void> {
  const issue = getIssue(issueNumber);

  if (!issue) {
    console.log(chalk.red(`\n❌ Issue #${issueNumber} not found\n`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold.cyan(`#${issue.number}`) + ' ' + chalk.bold(issue.title));
  console.log(chalk.dim(issue.url));
  console.log();

  if (issue.body) {
    console.log(issue.body);
  } else {
    console.log(chalk.dim('No description provided.'));
  }
  console.log();
}
