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
