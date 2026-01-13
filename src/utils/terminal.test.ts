import { describe, it, expect } from 'vitest';
import {
  getSearchPatterns,
  generateITermCloseScript,
  generateTerminalCloseScript,
  generateVSCodeCloseScript,
  closeWindowsForWorktree,
  CloseTerminalOptions,
} from './terminal';

describe('terminal utilities', () => {
  describe('getSearchPatterns', () => {
    it('should generate patterns for folder path and issue number', () => {
      const options: CloseTerminalOptions = {
        folderPath: '/Users/test/project-issue-42-fix-bug',
        issueNumber: '42',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain('project-issue-42-fix-bug');
      expect(patterns).toContain('Issue #42');
      expect(patterns).toContain('issue-42-');
    });

    it('should include PR patterns when prNumber is provided', () => {
      const options: CloseTerminalOptions = {
        folderPath: '/Users/test/project-issue-42-fix-bug',
        issueNumber: '42',
        prNumber: '123',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain('PR #123');
      expect(patterns).toContain('Review PR #123');
    });

    it('should not include PR patterns when prNumber is not provided', () => {
      const options: CloseTerminalOptions = {
        folderPath: '/Users/test/project-issue-42-fix-bug',
        issueNumber: '42',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).not.toContain('PR #');
      expect(patterns).not.toContain('Review PR #');
    });

    it('should handle paths with only folder name', () => {
      const options: CloseTerminalOptions = {
        folderPath: 'my-project-issue-1-test',
        issueNumber: '1',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain('my-project-issue-1-test');
      expect(patterns).toContain('Issue #1');
    });
  });

  describe('generateITermCloseScript', () => {
    it('should generate valid AppleScript with patterns', () => {
      const patterns = ['project-issue-42', 'Issue #42'];
      const script = generateITermCloseScript(patterns);

      expect(script).toContain('tell application "iTerm"');
      expect(script).toContain('project-issue-42');
      expect(script).toContain('Issue #42');
      expect(script).toContain('windowsToClose');
      expect(script).toContain('sessionsToClose');
    });

    it('should escape double quotes in patterns', () => {
      const patterns = ['Issue "quoted"'];
      const script = generateITermCloseScript(patterns);

      expect(script).toContain('Issue \\"quoted\\"');
    });

    it('should use two-pass approach for closing', () => {
      const patterns = ['test'];
      const script = generateITermCloseScript(patterns);

      // First pass collects
      expect(script).toContain('First pass: collect');
      // Second pass closes sessions
      expect(script).toContain('Second pass: close sessions');
      // Third pass closes windows
      expect(script).toContain('Third pass: close entire windows');
    });
  });

  describe('generateTerminalCloseScript', () => {
    it('should generate valid AppleScript for Terminal.app', () => {
      const patterns = ['project-issue-42', 'Issue #42'];
      const script = generateTerminalCloseScript(patterns);

      expect(script).toContain('tell application "Terminal"');
      expect(script).toContain('project-issue-42');
      expect(script).toContain('Issue #42');
      expect(script).toContain('windowsToClose');
    });

    it('should create OR conditions for multiple patterns', () => {
      const patterns = ['pattern1', 'pattern2'];
      const script = generateTerminalCloseScript(patterns);

      expect(script).toContain('windowName contains "pattern1" or windowName contains "pattern2"');
    });

    it('should use two-pass approach to avoid iteration issues', () => {
      const patterns = ['test'];
      const script = generateTerminalCloseScript(patterns);

      expect(script).toContain('First pass: collect window IDs');
      expect(script).toContain('Second pass: close windows by ID');
    });
  });

  describe('generateVSCodeCloseScript', () => {
    it('should generate valid AppleScript for VS Code', () => {
      const patterns = ['project-issue-42'];
      const script = generateVSCodeCloseScript(patterns);

      expect(script).toContain('tell application "System Events"');
      expect(script).toContain('process "Code"');
      expect(script).toContain('AXCloseButton');
    });

    it('should handle multiple patterns', () => {
      const patterns = ['folder-name', 'Issue #42'];
      const script = generateVSCodeCloseScript(patterns);

      expect(script).toContain('folder-name');
      expect(script).toContain('Issue #42');
    });
  });

  describe('closeWindowsForWorktree', () => {
    it('should return object with boolean results', () => {
      // This test verifies the function returns the expected shape
      // The actual behavior depends on the platform and running applications
      const result = closeWindowsForWorktree({
        folderPath: '/test/path/project-issue-999-nonexistent',
        issueNumber: '999',
      });

      expect(result).toHaveProperty('iTerm');
      expect(result).toHaveProperty('terminal');
      expect(result).toHaveProperty('vscode');
      expect(typeof result.iTerm).toBe('boolean');
      expect(typeof result.terminal).toBe('boolean');
      expect(typeof result.vscode).toBe('boolean');
    });

    it('should handle prNumber parameter', () => {
      const result = closeWindowsForWorktree({
        folderPath: '/test/path/project-issue-999-nonexistent',
        issueNumber: '999',
        prNumber: '888',
      });

      expect(result).toHaveProperty('iTerm');
      expect(result).toHaveProperty('terminal');
      expect(result).toHaveProperty('vscode');
    });
  });

  describe('pattern matching edge cases', () => {
    it('should handle issue numbers with leading zeros', () => {
      const options: CloseTerminalOptions = {
        folderPath: '/path/project-issue-007-bond',
        issueNumber: '007',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain('Issue #007');
      expect(patterns).toContain('issue-007-');
    });

    it('should handle long issue titles in folder names', () => {
      const longSlug = 'this-is-a-very-long-issue-title';
      const options: CloseTerminalOptions = {
        folderPath: `/path/project-issue-42-${longSlug}`,
        issueNumber: '42',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain(`project-issue-42-${longSlug}`);
    });

    it('should handle empty folder path gracefully', () => {
      const options: CloseTerminalOptions = {
        folderPath: '',
        issueNumber: '42',
      };

      const patterns = getSearchPatterns(options);

      // Should still have issue-related patterns even with empty path
      expect(patterns).toContain('Issue #42');
      expect(patterns).toContain('issue-42-');
    });

    it('should handle paths with special characters', () => {
      const options: CloseTerminalOptions = {
        folderPath: '/Users/user name/project-issue-42-fix',
        issueNumber: '42',
      };

      const patterns = getSearchPatterns(options);

      expect(patterns).toContain('project-issue-42-fix');
    });
  });

  describe('AppleScript generation robustness', () => {
    it('should not have nested quotes issues in iTerm script', () => {
      const patterns = ['test"pattern', "another'pattern"];
      const script = generateITermCloseScript(patterns);

      // Script should be syntactically valid (quotes should be escaped)
      expect(script).toContain('test\\"pattern');
      expect(script).not.toContain('""'); // No empty quotes from bad escaping
    });

    it('should not have nested quotes issues in Terminal script', () => {
      const patterns = ['test"pattern'];
      const script = generateTerminalCloseScript(patterns);

      expect(script).toContain('test\\"pattern');
    });

    it('should not have nested quotes issues in VSCode script', () => {
      const patterns = ['test"pattern'];
      const script = generateVSCodeCloseScript(patterns);

      expect(script).toContain('test\\"pattern');
    });
  });
});
