import chalk from 'chalk';
import ora from 'ora';
import { createIssue } from '../utils/github';
import { solveCommand } from './solve';

export async function newCommand(
  title: string,
  options: { body?: string; label?: string[] }
): Promise<void> {
  const spinner = ora('Creating issue...').start();

  const issueNumber = createIssue(title, options.body, options.label);

  if (!issueNumber) {
    spinner.fail('Failed to create issue');
    console.log(chalk.dim('Make sure you have write access to this repository.'));
    process.exit(1);
  }

  spinner.succeed(`Created issue #${issueNumber}`);
  console.log(chalk.dim(`Title: ${title}\n`));

  // Now solve it immediately
  await solveCommand(issueNumber);
}
