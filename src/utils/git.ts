import { execSync } from 'child_process';

export function exec(command: string, cwd?: string): string {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    return '';
  }
}

export function execOrFail(command: string, cwd?: string): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function getProjectRoot(): string {
  try {
    return exec('git rev-parse --show-toplevel') || process.cwd();
  } catch {
    return process.cwd();
  }
}

export function getProjectName(): string {
  // Try to get from git remote
  const remoteUrl = exec('git config --get remote.origin.url');
  if (remoteUrl) {
    // Extract repo name from URL (handles both HTTPS and SSH)
    const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }
  // Fallback to current directory name
  return require('path').basename(process.cwd());
}

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function branchExists(branchName: string): boolean {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function getCommitCount(worktreePath: string): number {
  try {
    const output = exec(
      'git log origin/main..HEAD --oneline',
      worktreePath
    );
    if (!output) return 0;
    return output.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function getCommitList(worktreePath: string, limit = 10): string {
  return exec(
    `git log origin/main..HEAD --pretty=format:'- %s' | head -${limit}`,
    worktreePath
  );
}
