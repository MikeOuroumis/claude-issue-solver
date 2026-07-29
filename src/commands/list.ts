import chalk from 'chalk';
import { listIssues, getIssuesWithOpenPRs, getTotalIssueCount } from '../utils/github';
import { getProjectName } from '../utils/git';

function formatBody(body: string, indent: string, termWidth: number): string[] {
  if (!body) return [];
  const lines = body.split('\n');
  const output: string[] = [];
  const textWidth = termWidth - indent.length - 2;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      // Preserve blank lines
      output.push('');
      continue;
    }

    // Handle markdown headers - make them stand out
    if (trimmed.startsWith('#')) {
      const headerText = trimmed.replace(/^#+\s*/, '');
      output.push(indent + headerText);
      continue;
    }

    // Handle list items
    if (trimmed.match(/^[-*]\s/) || trimmed.match(/^\d+\.\s/)) {
      output.push(indent + '  ' + trimmed);
      continue;
    }

    // Word wrap regular text
    if (trimmed.length <= textWidth) {
      output.push(indent + trimmed);
    } else {
      const words = trimmed.split(/\s+/);
      let currentLine = '';
      for (const word of words) {
        if (!currentLine) {
          currentLine = word;
        } else if (currentLine.length + 1 + word.length <= textWidth) {
          currentLine += ' ' + word;
        } else {
          output.push(indent + currentLine);
          currentLine = word;
        }
      }
      if (currentLine) {
        output.push(indent + currentLine);
      }
    }
  }

  return output;
}

export async function listCommand(options: { verbose?: boolean; limit?: number; all?: boolean } = {}): Promise<void> {
  const projectName = getProjectName();
  console.log(chalk.bold(`\nOpen issues for ${projectName}:\n`));

  const limit = options.all ? 0 : (options.limit ?? 50);
  const issues = listIssues(limit);

  if (issues.length === 0) {
    console.log(chalk.yellow('No open issues found.'));
    return;
  }

  // Show hint if we hit the limit and user didn't explicitly set options
  const hitLimit = !options.all && !options.limit && issues.length === limit;
  if (hitLimit) {
    const totalCount = getTotalIssueCount();
    if (totalCount > limit) {
      console.log(chalk.dim(`  Showing ${limit} of ${totalCount} issues. Use --limit <n> or --all to see more.\n`));
    } else {
      console.log(chalk.dim(`  Showing first ${limit} issues. Use --limit <n> or --all to see more.\n`));
    }
  }

  const issuesWithPRs = getIssuesWithOpenPRs();

  for (const issue of issues) {
    const prTag = issuesWithPRs.has(issue.number) ? chalk.magenta(' [PR]') : '';
    const labels = issue.labels.length > 0
      ? ' ' + issue.labels.map(l => chalk.hex(`#${l.color}`).bold(`[${l.name}]`)).join(' ')
      : '';
    console.log(`  ${chalk.cyan(`#${issue.number}`)}\t${issue.title}${prTag}${labels}`);

    if (options.verbose && issue.body) {
      const termWidth = process.stdout.columns || 80;
      const indent = '        ';
      const formattedLines = formatBody(issue.body, indent, termWidth);
      for (const line of formattedLines) {
        console.log(chalk.dim(line));
      }
      console.log(); // blank line between issues
    }
  }
  console.log();
}
