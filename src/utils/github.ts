import { execSync } from 'child_process';

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface IssueListItem {
  number: number;
  title: string;
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

export function listIssues(limit = 20): IssueListItem[] {
  try {
    const output = execSync(
      `gh issue list --state open --limit ${limit} --json number,title`,
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

export function getPRForBranch(branch: string): PRStatus | null {
  try {
    const output = execSync(
      `gh pr list --head "${branch}" --state all --json state,url --limit 1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);
    if (data.length === 0) return null;
    return {
      state: data[0].state.toLowerCase() as 'open' | 'closed' | 'merged',
      url: data[0].url,
    };
  } catch {
    return null;
  }
}
