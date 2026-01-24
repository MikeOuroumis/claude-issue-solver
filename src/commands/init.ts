import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { AIToolType, AI_TOOLS, getAllAITools } from '../utils/ai-tool';
import { setAITool, getAITool } from './config';

interface Requirement {
  name: string;
  check: () => boolean;
  install?: () => boolean;
  authCheck?: () => boolean;
  auth?: () => boolean;
  installCmd: string;
  authCmd?: string;
}

export function commandExists(cmd: string): boolean {
  const isWindows = process.platform === 'win32';
  const checkCmd = isWindows ? `where ${cmd}` : `which ${cmd}`;
  try {
    execSync(checkCmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isClaudeAuthenticated(): boolean {
  try {
    // Claude Code stores auth in ~/.claude or similar
    // Just check if it runs without error
    execSync('claude --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function installWithBrew(pkg: string): boolean {
  if (!commandExists('brew')) {
    console.log(chalk.yellow(`\n   Homebrew not found. Please install ${pkg} manually.`));
    return false;
  }
  try {
    console.log(chalk.dim(`\n   Running: brew install ${pkg}`));
    spawnSync('brew', ['install', pkg], { stdio: 'inherit' });
    return commandExists(pkg === 'gh' ? 'gh' : pkg);
  } catch {
    return false;
  }
}

function installWithNpm(pkg: string): boolean {
  try {
    console.log(chalk.dim(`\n   Running: npm install -g ${pkg}`));
    spawnSync('npm', ['install', '-g', pkg], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function runGhAuth(): boolean {
  try {
    console.log(chalk.dim('\n   Running: gh auth login'));
    console.log(chalk.cyan('   Follow the prompts to authenticate with GitHub:\n'));
    spawnSync('gh', ['auth', 'login'], { stdio: 'inherit' });
    return isGhAuthenticated();
  } catch {
    return false;
  }
}

function runClaudeAuth(): boolean {
  try {
    console.log(chalk.dim('\n   Running: claude'));
    console.log(chalk.cyan('   Follow the prompts to authenticate with Anthropic:\n'));
    spawnSync('claude', ['--help'], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

export async function initCommand(): Promise<void> {
  console.log(chalk.bold('\n🔧 Claude Issue Solver - Setup\n'));

  const platform = os.platform();
  const isMac = platform === 'darwin';

  const requirements: Requirement[] = [
    {
      name: 'Node.js',
      check: () => {
        try {
          const version = execSync('node --version', { encoding: 'utf-8' }).trim();
          const major = parseInt(version.replace('v', '').split('.')[0], 10);
          return major >= 18;
        } catch {
          return false;
        }
      },
      installCmd: 'https://nodejs.org/ or: brew install node',
    },
    {
      name: 'GitHub CLI',
      check: () => commandExists('gh'),
      install: () => installWithBrew('gh'),
      authCheck: isGhAuthenticated,
      auth: runGhAuth,
      installCmd: isMac ? 'brew install gh' : 'https://cli.github.com/',
      authCmd: 'gh auth login',
    },
    {
      name: 'Git',
      check: () => commandExists('git'),
      installCmd: isMac ? 'xcode-select --install' : 'apt install git',
    },
  ];

  let allPassed = true;

  for (const req of requirements) {
    const spinner = ora(`Checking ${req.name}...`).start();

    // Check if installed
    if (req.check()) {
      // Check if authenticated (if applicable)
      if (req.authCheck && !req.authCheck()) {
        spinner.warn(chalk.yellow(`${req.name} - not authenticated`));

        if (req.auth) {
          const authSpinner = ora(`Authenticating ${req.name}...`).start();
          authSpinner.stop();

          if (req.auth()) {
            console.log(chalk.green(`   ✓ ${req.name} authenticated`));
          } else {
            console.log(chalk.red(`   ✗ ${req.name} authentication failed`));
            console.log(chalk.dim(`     Run manually: ${req.authCmd}`));
            allPassed = false;
          }
        }
      } else {
        spinner.succeed(chalk.green(`${req.name}`));
      }
    } else {
      spinner.fail(chalk.red(`${req.name} - not found`));

      // Try to install
      if (req.install && isMac) {
        const installSpinner = ora(`Installing ${req.name}...`).start();
        installSpinner.stop();

        if (req.install()) {
          console.log(chalk.green(`   ✓ ${req.name} installed`));

          // Now check auth if needed
          if (req.authCheck && !req.authCheck() && req.auth) {
            console.log(chalk.yellow(`   → ${req.name} needs authentication`));
            if (req.auth()) {
              console.log(chalk.green(`   ✓ ${req.name} authenticated`));
            } else {
              console.log(chalk.red(`   ✗ ${req.name} authentication failed`));
              console.log(chalk.dim(`     Run manually: ${req.authCmd}`));
              allPassed = false;
            }
          }
        } else {
          console.log(chalk.red(`   ✗ Failed to install ${req.name}`));
          console.log(chalk.dim(`     Install manually: ${req.installCmd}`));
          allPassed = false;
        }
      } else {
        console.log(chalk.dim(`     Install: ${req.installCmd}`));
        allPassed = false;
      }
    }
  }

  console.log();

  if (allPassed) {
    // Detect available AI tools
    const availableTools = getAllAITools().filter(tool => commandExists(tool.command));
    
    if (availableTools.length === 0) {
      console.log(chalk.yellow.bold('⚠️  No AI coding tool found.\n'));
      console.log(chalk.dim('Please install at least one of the following:'));
      for (const tool of getAllAITools()) {
        console.log(chalk.cyan(`  ${tool.name}: ${tool.installCmd}`));
      }
      console.log();
      return;
    }

    let selectedTool: AIToolType;

    if (availableTools.length === 1) {
      selectedTool = availableTools[0].type;
      console.log(chalk.green(`✓ AI Tool: ${availableTools[0].name}`));
    } else {
      console.log(chalk.green('✓ Multiple AI tools detected\n'));
      const { tool } = await inquirer.prompt([
        {
          type: 'list',
          name: 'tool',
          message: 'Select AI tool to use:',
          choices: availableTools.map(t => ({
            name: t.name,
            value: t.type,
          })),
          default: getAITool(),
        },
      ]);
      selectedTool = tool;
    }

    setAITool(selectedTool);
    const toolConfig = AI_TOOLS[selectedTool];
    console.log(chalk.dim(`   Using: ${toolConfig.name}`));

    console.log();
    console.log(chalk.green.bold('✅ All requirements met! You\'re ready to use claude-issue.\n'));
    console.log(chalk.dim('Try running:'));
    console.log(chalk.cyan('  claude-issue list    # List open issues'));
    console.log(chalk.cyan('  claude-issue         # Interactive issue selection'));
    console.log(chalk.cyan('  claude-issue new "Title"  # Create and solve new issue\n'));
  } else {
    console.log(chalk.yellow.bold('⚠️  Some requirements are missing.\n'));
    console.log(chalk.dim('Please install the missing requirements and run `claude-issue init` again.\n'));
  }
}
