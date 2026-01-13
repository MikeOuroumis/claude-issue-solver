import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface Label {
  name: string;
  color: string;
}

export interface IssueListItem {
  number: number;
  title: string;
  body: string;
  labels: Label[];
}

export function createIssue(title: string, body?: string, labels?: string[]): number | null {
  try {
    // Build args array to avoid shell escaping issues
    // Note: gh issue create requires both --title and --body when non-interactive
    const args = ['issue', 'create', '--title', title, '--body', body || title];

    if (labels && labels.length > 0) {
      for (const label of labels) {
        args.push('--label', label);
      }
    }

    // Use single quotes with proper escaping for shell safety
    const cmd = `gh ${args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ')}`;

    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Output is the issue URL, extract the number
    const match = output.trim().match(/\/issues\/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  } catch (error: any) {
    // Log error for debugging
    if (process.env.DEBUG) {
      console.error('createIssue error:', error.stderr?.toString() || error.message);
    }
    return null;
  }
}

export function getIssue(issueNumber: number): Issue | null {
  try {
    const output = execSync(
      `gh issue view ${issueNumber} --json title,body,url`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);
    return {
      number: issueNumber,
      title: data.title,
      body: data.body || '',
      url: data.url,
    };
  } catch {
    return null;
  }
}

export function listIssues(limit = 50): IssueListItem[] {
  try {
    // When limit is 0, fetch all (use a high number since gh requires --limit)
    const actualLimit = limit > 0 ? limit : 1000;
    const output = execSync(
      `gh issue list --state open --limit ${actualLimit} --json number,title,body,labels`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return JSON.parse(output);
  } catch {
    return [];
  }
}

export function createPullRequest(
  title: string,
  body: string,
  branch: string,
  base = 'main'
): string {
  const output = execSync(
    `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --head "${branch}" --base "${base}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return output.trim();
}

export interface IssueStatus {
  state: 'open' | 'closed';
}

export interface PRStatus {
  number: number;
  state: 'open' | 'closed' | 'merged';
  url: string;
}

export function getIssueStatus(issueNumber: number): IssueStatus | null {
  try {
    const output = execSync(
      `gh issue view ${issueNumber} --json state`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);
    return {
      state: data.state.toLowerCase() as 'open' | 'closed',
    };
  } catch {
    return null;
  }
}

export async function getIssueStatusAsync(issueNumber: number): Promise<IssueStatus | null> {
  try {
    const { stdout } = await execAsync(`gh issue view ${issueNumber} --json state`);
    const data = JSON.parse(stdout);
    return {
      state: data.state.toLowerCase() as 'open' | 'closed',
    };
  } catch {
    return null;
  }
}

export function getPRForBranch(branch: string): PRStatus | null {
  try {
    const output = execSync(
      `gh pr list --head "${branch}" --state all --json number,state,url --limit 1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);
    if (data.length === 0) return null;
    return {
      number: data[0].number,
      state: data[0].state.toLowerCase() as 'open' | 'closed' | 'merged',
      url: data[0].url,
    };
  } catch {
    return null;
  }
}

export async function getPRForBranchAsync(branch: string): Promise<PRStatus | null> {
  try {
    const { stdout } = await execAsync(`gh pr list --head "${branch}" --state all --json number,state,url --limit 1`);
    const data = JSON.parse(stdout);
    if (data.length === 0) return null;
    return {
      number: data[0].number,
      state: data[0].state.toLowerCase() as 'open' | 'closed' | 'merged',
      url: data[0].url,
    };
  } catch {
    return null;
  }
}

/**
 * Get all open PRs with their head branch names (single API call)
 * Returns a Set of issue numbers that have open PRs from issue-{number}-* branches
 */
export function getIssuesWithOpenPRs(): Set<number> {
  try {
    const output = execSync(
      `gh pr list --state open --json headRefName --limit 100`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output) as { headRefName: string }[];
    const issueNumbers = new Set<number>();

    for (const pr of data) {
      // Match branches like "issue-42-fix-bug"
      const match = pr.headRefName.match(/^issue-(\d+)-/);
      if (match) {
        issueNumbers.add(parseInt(match[1], 10));
      }
    }

    return issueNumbers;
  } catch {
    return new Set();
  }
}
