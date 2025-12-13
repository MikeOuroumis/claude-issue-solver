import chalk from 'chalk';
import { listIssues } from '../utils/github';
import { getProjectName } from '../utils/git';

export async function listCommand(): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const issues = listIssues();

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
  }

  for (const issue of issues) {
    console.log(`  ${chalk.cyan(`#${issue.number}`)}\t${issue.title}`);
  }
  console.log();
}
