#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { checkRequirements } from './utils/helpers';
import { isGitRepo } from './utils/git';
import { listCommand } from './commands/list';
import { solveCommand } from './commands/solve';
import { prCommand } from './commands/pr';
import { cleanCommand, cleanAllCommand, cleanMergedCommand } from './commands/clean';
import { selectCommand } from './commands/select';
import { goCommand } from './commands/go';
import { newCommand } from './commands/new';
import { initCommand } from './commands/init';
import { showCommand } from './commands/show';
import { reviewCommand, selectReviewCommand } from './commands/review';
import { configCommand } from './commands/config';
import { mergeCommand } from './commands/merge';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json');

const program = new Command();

program
  .name('claude-issue')
  .description('Automatically solve GitHub issues using Claude Code')
  .version(packageJson.version, '-v, --version', 'Show version number');

// Commands that skip requirements check
const skipRequirementsCommands = ['init'];

// Check requirements before any command (except init)
program.hook('preAction', (thisCommand) => {
  const commandName = thisCommand.name();
  if (skipRequirementsCommands.includes(commandName)) {
    return;
  }

  if (!isGitRepo()) {
    console.log(chalk.red('❌ Not in a git repository'));
    process.exit(1);
  }

  const { ok, missing } = checkRequirements();
  if (!ok) {
    console.log(chalk.red('\n❌ Missing requirements:\n'));
    for (const m of missing) {
      console.log(chalk.yellow(`   • ${m}`));
    }
    console.log();
    process.exit(1);
  }
});

// Default command - interactive selection
program
  .argument('[issue]', 'Issue number to solve')
  .option('-c, --auto-close', 'Close terminal and clean up worktree after PR is created')
  .action(async (issue: string | undefined, options: { autoClose?: boolean }) => {
    if (issue) {
      const issueNumber = parseInt(issue, 10);
      if (isNaN(issueNumber)) {
        console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
        process.exit(1);
      }
      await solveCommand(issueNumber, { autoClose: options.autoClose });
    } else {
      await selectCommand(options);
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List open issues')
  .option('--verbose', 'Show issue descriptions')
  .option('-n, --limit <number>', 'Maximum number of issues to show', (val) => parseInt(val, 10))
  .option('--all', 'Show all issues (no limit)')
  .action((options: { verbose?: boolean; limit?: number; all?: boolean }) => listCommand(options));

// Show command
program
  .command('show <issue>')
  .description('Show full details of an issue')
  .action(async (issue: string) => {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
      console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
      process.exit(1);
    }
    await showCommand(issueNumber);
  });

// PR command
program
  .command('pr <issue>')
  .description('Create PR for a solved issue')
  .action(async (issue: string) => {
    const issueNumber = parseInt(issue, 10);
    if (isNaN(issueNumber)) {
      console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
      process.exit(1);
    }
    await prCommand(issueNumber);
  });

// Clean command
program
  .command('clean [issue]')
  .alias('rm')
  .option('-a, --all', 'Clean all issue worktrees')
  .option('-m, --merged', 'Clean only worktrees with merged PRs (no confirmation)')
  .description('Remove worktree and branch for an issue (or all with --all, or merged with --merged)')
  .action(async (issue: string | undefined, options: { all?: boolean; merged?: boolean }) => {
    if (options.merged) {
      await cleanMergedCommand();
    } else if (options.all) {
      await cleanAllCommand();
    } else if (issue) {
      const issueNumber = parseInt(issue, 10);
      if (isNaN(issueNumber)) {
        console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
        process.exit(1);
      }
      await cleanCommand(issueNumber);
    } else {
      // No issue and no --all flag, show all and let user choose
      await cleanAllCommand();
    }
  });

// Go command - navigate to worktree and open PR
program
  .command('go [issue]')
  .description('Navigate to an issue worktree, open VS Code, or view PR')
  .action(async (issue?: string) => {
    const issueNumber = issue ? parseInt(issue, 10) : undefined;
    if (issue && isNaN(issueNumber!)) {
      console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
      process.exit(1);
    }
    await goCommand(issueNumber);
  });

// New command - create issue and solve it
program
  .command('new <title>')
  .description('Create a new issue and immediately start solving it')
  .option('-b, --body <body>', 'Issue description')
  .option('-l, --label <label...>', 'Add labels to the issue')
  .action(async (title: string, options: { body?: string; label?: string[] }) => {
    await newCommand(title, options);
  });

// Init command - guided setup
program
  .command('init')
  .description('Check and install requirements (gh, claude-code)')
  .action(async () => {
    await initCommand();
  });

// Review command - AI code review for PRs
program
  .command('review [issue]')
  .description('Review PRs with Claude and post suggestions')
  .option('-m, --merge', 'Automatically merge PR if approved')
  .action(async (issue: string | undefined, options: { merge?: boolean }) => {
    if (issue) {
      const issueNumber = parseInt(issue, 10);
      if (isNaN(issueNumber)) {
        console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
        process.exit(1);
      }
      await reviewCommand(issueNumber, { merge: options.merge });
    } else {
      await selectReviewCommand({ merge: options.merge });
    }
  });

// Config command - manage settings
program
  .command('config [action] [value]')
  .description('Manage configuration (bot-token, --clear)')
  .action(async (action?: string, value?: string) => {
    await configCommand(action, value);
  });

// Merge command - merge PRs and clean up
program
  .command('merge')
  .description('Merge approved PRs and clean up worktrees')
  .action(async () => {
    await mergeCommand();
  });

program.parse();
