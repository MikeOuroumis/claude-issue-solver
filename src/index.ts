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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package.json');

const program = new Command();

program
  .name('claude-issue')
  .description('Automatically solve GitHub issues using Claude Code')
  .version(packageJson.version);

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
  .action(async (issue?: string) => {
    if (issue) {
      const issueNumber = parseInt(issue, 10);
      if (isNaN(issueNumber)) {
        console.log(chalk.red(`❌ Invalid issue number: ${issue}`));
        process.exit(1);
      }
      await solveCommand(issueNumber);
    } else {
      await selectCommand();
    }
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List open issues')
  .action(listCommand);

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

program.parse();
