import chalk from 'chalk';
import { listIssues, getIssuesWithOpenPRs } from '../utils/github';
import { getProjectName } from '../utils/git';

function getFirstParagraph(body: string): string {
  if (!body) return '';
  const lines = body.split('\n');
  const paragraphLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip markdown headers and horizontal rules
    if (trimmed.startsWith('#') || trimmed.match(/^-{3,}$|^_{3,}$|^\*{3,}$/)) {
      continue;
    }
    // Empty line after we started means end of paragraph
    if (!trimmed && started) {
      break;
    }
    if (trimmed) {
      started = true;
      paragraphLines.push(trimmed);
    }
  }
  return paragraphLines.join(' ');
}

function wrapText(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += ' ' + word;
    } else {
      lines.push(indent + currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(indent + currentLine);
  }
  return lines;
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
      const paragraph = getFirstParagraph(issue.body);
      if (paragraph) {
        const termWidth = process.stdout.columns || 80;
        const indent = '        ';
        const textWidth = termWidth - indent.length - 2;
        const wrappedLines = wrapText(paragraph, textWidth, indent);
        for (const line of wrappedLines) {
          console.log(chalk.dim(line));
        }
        console.log(); // blank line between issues
      }
    }
  }
  console.log();
}
