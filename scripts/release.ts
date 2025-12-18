import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function exec(cmd: string, silent = false): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: silent ? 'pipe' : 'inherit' }).trim();
  } catch {
    return '';
  }
}

function execOutput(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
}

const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

async function main() {
  const args = process.argv.slice(2);

  // Get current version
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  const currentVersion = pkg.version;
  console.log(colors.cyan(`Current version: ${currentVersion}`));

  // Get new version
  let newVersion = args[0];
  if (!newVersion) {
    newVersion = await prompt('Enter new version: ');
  }

  // Validate version format
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error(colors.red('Error: Invalid version format. Use semver (e.g., 1.15.0)'));
    process.exit(1);
  }

  // Get release title (optional)
  let releaseTitle = args[1];
  if (!releaseTitle) {
    releaseTitle = await prompt('Release title (optional, press enter to skip): ');
  }

  // Show recent commits
  const lastTag = execOutput('git describe --tags --abbrev=0 2>/dev/null || echo ""');
  if (lastTag) {
    console.log(colors.cyan(`\nCommits since ${lastTag}:`));
    const commits = execOutput(`git log "${lastTag}..HEAD" --pretty=format:"- %s" --no-merges`)
      .split('\n')
      .filter((line) => !line.match(/^- \d+\.\d+\.\d+$/))
      .slice(0, 20);
    console.log(commits.join('\n'));
  }

  // Get changelog
  console.log(colors.yellow('\nEnter changelog (one item per line, empty line to finish):'));
  const changelogItems: string[] = [];
  while (true) {
    const line = await prompt('');
    if (!line) break;
    changelogItems.push(`- ${line}`);
  }

  if (changelogItems.length === 0) {
    console.error(colors.red('Error: Changelog is required'));
    process.exit(1);
  }

  const changelog = changelogItems.join('\n');

  // Confirm
  console.log(colors.cyan('\n=== Release Summary ==='));
  console.log(`Version: ${colors.green(`v${newVersion}`)}`);
  if (releaseTitle) {
    console.log(`Title: ${colors.green(`v${newVersion} - ${releaseTitle}`)}`);
  }
  console.log(`Changelog:\n${changelog}`);

  const confirm = await prompt('\nProceed with release? (y/N) ');
  if (confirm.toLowerCase() !== 'y') {
    console.log(colors.yellow('Aborted.'));
    process.exit(0);
  }

  rl.close();

  // Update package.json
  console.log(colors.cyan('\nUpdating package.json...'));
  pkg.version = newVersion;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

  // Build
  console.log(colors.cyan('Building...'));
  exec('npm run build');

  // Commit version bump
  console.log(colors.cyan('Committing version bump...'));
  exec('git add package.json package-lock.json 2>/dev/null || git add package.json', true);
  exec(`git commit -m "${newVersion}"`);

  // Create git tag
  console.log(colors.cyan(`Creating git tag v${newVersion}...`));
  exec(`git tag "v${newVersion}"`);

  // Push commits and tags
  console.log(colors.cyan('Pushing to origin...'));
  exec('git push origin main');
  exec(`git push origin "v${newVersion}"`);

  // Publish to npm
  console.log(colors.cyan('Publishing to npm...'));
  exec('npm publish');

  // Create GitHub release
  console.log(colors.cyan('Creating GitHub release...'));
  const releaseName = releaseTitle ? `v${newVersion} - ${releaseTitle}` : `v${newVersion}`;
  const releaseNotes = `### What's New\n\n${changelog}`;

  exec(`gh release create "v${newVersion}" --title "${releaseName}" --notes "${releaseNotes.replace(/"/g, '\\"')}"`);

  console.log(colors.green(`\nReleased v${newVersion}!`));
  console.log('npm: https://www.npmjs.com/package/claude-issue-solver');
  console.log(`GitHub: https://github.com/MikeOuroumis/claude-issue-solver/releases/tag/v${newVersion}`);
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
