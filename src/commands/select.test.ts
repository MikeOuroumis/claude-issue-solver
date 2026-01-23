import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies
vi.mock('../utils/github', () => ({
  listIssues: vi.fn(),
  getIssuesWithOpenPRs: vi.fn(() => new Set()),
}));

vi.mock('../utils/git', () => ({
  getProjectName: vi.fn(() => 'test-project'),
}));

vi.mock('./solve', () => ({
  solveCommand: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(() => Promise.resolve({ issueNumbers: [] })),
  },
}));

import { listIssues } from '../utils/github';

describe('select command options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.log during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('limit option handling', () => {
    it('should use default limit of 50 when no options provided', async () => {
      const { selectCommand } = await import('./select');
      (listIssues as any).mockReturnValue([]);

      await selectCommand({});

      expect(listIssues).toHaveBeenCalledWith(50);
    });

    it('should use limit 0 when --all option is provided', async () => {
      const { selectCommand } = await import('./select');
      (listIssues as any).mockReturnValue([]);

      await selectCommand({ all: true });

      expect(listIssues).toHaveBeenCalledWith(0);
    });

    it('should use custom limit when --limit option is provided', async () => {
      const { selectCommand } = await import('./select');
      (listIssues as any).mockReturnValue([]);

      await selectCommand({ limit: 100 });

      expect(listIssues).toHaveBeenCalledWith(100);
    });

    it('should prioritize --all over --limit when both provided', async () => {
      const { selectCommand } = await import('./select');
      (listIssues as any).mockReturnValue([]);

      await selectCommand({ all: true, limit: 100 });

      // --all should take precedence, setting limit to 0
      expect(listIssues).toHaveBeenCalledWith(0);
    });
  });

  describe('hint message', () => {
    it('should show hint when hitting default limit of 50', async () => {
      const { selectCommand } = await import('./select');
      const mockConsoleLog = vi.spyOn(console, 'log');

      // Return exactly 50 issues to trigger the hint
      const fiftyIssues = Array.from({ length: 50 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: '',
        labels: [],
      }));
      (listIssues as any).mockReturnValue(fiftyIssues);

      await selectCommand({});

      // Should show hint about using --limit or --all
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('--limit')
      );
    });

    it('should not show hint when --all is used', async () => {
      const { selectCommand } = await import('./select');
      const mockConsoleLog = vi.spyOn(console, 'log');

      const fiftyIssues = Array.from({ length: 50 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: '',
        labels: [],
      }));
      (listIssues as any).mockReturnValue(fiftyIssues);

      await selectCommand({ all: true });

      // Should NOT show hint about using --limit or --all
      const calls = mockConsoleLog.mock.calls.flat().join(' ');
      expect(calls).not.toContain('Use --limit');
    });

    it('should not show hint when custom --limit is used', async () => {
      const { selectCommand } = await import('./select');
      const mockConsoleLog = vi.spyOn(console, 'log');

      const issues = Array.from({ length: 25 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: '',
        labels: [],
      }));
      (listIssues as any).mockReturnValue(issues);

      await selectCommand({ limit: 25 });

      // Should NOT show hint about using --limit or --all
      const calls = mockConsoleLog.mock.calls.flat().join(' ');
      expect(calls).not.toContain('Use --limit');
    });
  });
});
