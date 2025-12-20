import chalk from 'chalk';
import { listIssues, getIssuesWithOpenPRs } from '../utils/github';
import { getProjectName } from '../utils/git';

function truncateBody(body: string, maxLength = 100): string {
  if (!body) return '';
  // Take first line or truncate
  const firstLine = body.split('\n')[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return firstLine.substring(0, maxLength - 3) + '...';
}

export async function listCommand(options: { verbose?: boolean } = {}): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const issues = listIssues();

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
  }

  const issuesWithPRs = getIssuesWithOpenPRs();

  for (const issue of issues) {
    const prTag = issuesWithPRs.has(issue.number) ? chalk.magenta(' [PR]') : '';
    const labels = issue.labels.length > 0
      ? ' ' + issue.labels.map(l => chalk.hex(`#${l.color}`).bold(`[${l.name}]`)).join(' ')
      : '';
    console.log(`  ${chalk.cyan(`#${issue.number}`)}\t${issue.title}${prTag}${labels}`);

    if (options.verbose && issue.body) {
      const truncated = truncateBody(issue.body);
      if (truncated) {
        console.log(chalk.dim(`  \t${truncated}`));
      }
    }
  }
  console.log();
}
