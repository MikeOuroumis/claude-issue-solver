import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.claude-issue-solver');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  botToken?: string;
}

export function getConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return {};
}

export function saveConfig(config: Config): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getBotToken(): string | undefined {
  return getConfig().botToken;
}

function validateToken(token: string): { valid: boolean; login?: string; error?: string } {
  try {
    const output = execSync('gh api user --jq .login', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GH_TOKEN: token },
    });
    return { valid: true, login: output.trim() };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}

function getCurrentUser(): string | null {
  try {
    const output = execSync('gh api user --jq .login', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim();
  } catch {
    return null;
  }
}

export async function configCommand(action?: string, value?: string): Promise<void> {
  // Handle clear action
  if (action === '--clear' || action === 'clear') {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      console.log(chalk.green('\n✅ Configuration cleared.\n'));
    } else {
      console.log(chalk.dim('\nNo configuration to clear.\n'));
    }
    return;
  }

  // Handle bot-token action
  if (action === 'bot-token') {
    if (value) {
      // Direct token provided
      console.log(chalk.dim('\nValidating token...'));
      const result = validateToken(value);
      if (result.valid) {
        const config = getConfig();
        config.botToken = value;
        saveConfig(config);
        console.log(chalk.green(`\n✅ Bot token saved! Authenticated as: ${result.login}\n`));
      } else {
        console.log(chalk.red('\n❌ Invalid token. Please check and try again.\n'));
      }
      return;
    }

    // Interactive setup
    await setupBotToken();
    return;
  }

  // Show current config
  const config = getConfig();
  console.log(chalk.bold('\nClaude Issue Solver Configuration\n'));

  if (config.botToken) {
    const result = validateToken(config.botToken);
    if (result.valid) {
      console.log(`  Bot token: ${chalk.green('✓ Configured')} (${result.login})`);
    } else {
      console.log(`  Bot token: ${chalk.yellow('⚠ Invalid or expired')}`);
    }
  } else {
    console.log(`  Bot token: ${chalk.dim('Not configured')}`);
  }

  console.log();
  console.log(chalk.dim('Commands:'));
  console.log(chalk.dim('  cis config bot-token     Set up a bot token for reviews'));
  console.log(chalk.dim('  cis config --clear       Clear all configuration'));
  console.log();
}

async function setupBotToken(): Promise<void> {
  console.log(chalk.bold('\n🤖 Bot Token Setup\n'));

  console.log(`A bot token allows Claude to post formal reviews (approve/request changes)
on your own PRs. Without it, Claude can only post comments on your own PRs.

${chalk.bold('You have two options:')}\n`);

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'How would you like to set up the bot?',
      choices: [
        { name: 'Use my existing account (create a token)', value: 'same-account' },
        { name: 'Create a separate bot account (recommended for teams)', value: 'new-account' },
        { name: 'I already have a token', value: 'have-token' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ]);

  if (choice === 'cancel') {
    console.log(chalk.dim('\nCancelled.\n'));
    return;
  }

  if (choice === 'have-token') {
    await promptForToken();
    return;
  }

  if (choice === 'new-account') {
    console.log(chalk.bold('\n📝 Creating a Bot Account\n'));
    console.log(`1. Sign out of GitHub or open an incognito window
2. Create a new account (e.g., ${chalk.cyan('yourname-bot')})
   - Use email alias: ${chalk.cyan('you+bot@gmail.com')}
3. Add the bot as a collaborator to your repos:
   - Repo → Settings → Collaborators → Add the bot
4. Log into the bot account and create a token (next step)
`);

    const { ready } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ready',
        message: 'Ready to create a token for the bot account?',
        default: true,
      },
    ]);

    if (!ready) {
      console.log(chalk.dim('\nRun `cis config bot-token` when ready.\n'));
      return;
    }
  }

  // Open GitHub token page
  console.log(chalk.bold('\n🔑 Creating a Personal Access Token\n'));
  console.log(`I'll open GitHub's token creation page.

${chalk.bold.yellow('⚠️  Use a Classic Token for private repos you don\'t own!')}
Fine-grained tokens don't work well for collaborator access.

${chalk.bold('Option 1: Classic Token')} ${chalk.green('(recommended for private repos)')}
  • Click "${chalk.cyan('Generate new token (classic)')}"
  • Note: ${chalk.cyan('claude-issue-solver-bot')}
  • Expiration: ${chalk.cyan('90 days')}
  • Scope: ${chalk.cyan('repo')} (full control of private repositories)

${chalk.bold('Option 2: Fine-grained Token')} ${chalk.dim('(only for repos the bot owns)')}
  • Repository access: ${chalk.cyan('All repositories')}
  • Permissions: ${chalk.cyan('Pull requests')} (Read/write), ${chalk.cyan('Contents')} (Read)
`);

  const { openBrowser } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openBrowser',
      message: 'Open GitHub token page in browser?',
      default: true,
    },
  ]);

  if (openBrowser) {
    const tokenUrl = 'https://github.com/settings/tokens';
    try {
      if (process.platform === 'darwin') {
        execSync(`open "${tokenUrl}"`, { stdio: 'pipe' });
      } else if (process.platform === 'linux') {
        execSync(`xdg-open "${tokenUrl}"`, { stdio: 'pipe' });
      } else {
        console.log(chalk.dim(`\nOpen this URL: ${tokenUrl}\n`));
      }
      console.log(chalk.dim('\nOpened GitHub in your browser.\n'));
    } catch {
      console.log(chalk.dim(`\nOpen this URL: ${tokenUrl}\n`));
    }
  } else {
    console.log(chalk.dim('\nGo to: https://github.com/settings/personal-access-tokens/new\n'));
  }

  await promptForToken();
}

async function promptForToken(): Promise<void> {
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Paste your token here:',
      mask: '*',
    },
  ]);

  if (!token) {
    console.log(chalk.dim('\nNo token provided.\n'));
    return;
  }

  console.log(chalk.dim('\nValidating token...'));
  const result = validateToken(token);

  if (result.valid) {
    // Check if token belongs to the same user as current gh auth
    const currentUser = getCurrentUser();
    if (currentUser && result.login === currentUser) {
      console.log(chalk.red(`\n❌ This token belongs to your current account (${currentUser}).`));
      console.log(chalk.yellow('\n⚠️  To approve your own PRs, you need a DIFFERENT account.'));
      console.log(chalk.dim('\nGitHub doesn\'t allow approving your own PRs, even with a different token.'));
      console.log(chalk.dim('The bot must be a separate GitHub account.\n'));
      console.log('Steps to create a bot account:');
      console.log(chalk.dim('  1. Sign out of GitHub (or use incognito)'));
      console.log(chalk.dim(`  2. Create new account (e.g., ${currentUser}-bot)`));
      console.log(chalk.dim('  3. Add the bot as collaborator to your repos'));
      console.log(chalk.dim('  4. Create a token from the bot account'));
      console.log(chalk.dim('  5. Run `cis config bot-token` again\n'));
      return;
    }

    const config = getConfig();
    config.botToken = token;
    saveConfig(config);
    console.log(chalk.green(`\n✅ Bot token saved!`));
    console.log(chalk.dim(`   Authenticated as: ${result.login}`));
    console.log(chalk.dim(`   Config stored in: ${CONFIG_FILE}\n`));
    console.log(`Now when you run ${chalk.cyan('cis review')}, Claude can post formal reviews.\n`);
  } else {
    console.log(chalk.red('\n❌ Invalid token. Please check and try again.'));
    console.log(chalk.dim('   Run `cis config bot-token` to retry.\n'));
  }
}
