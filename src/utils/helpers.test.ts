import { describe, it, expect } from 'vitest';
import {
  slugify,
  generateITermOpenScript,
  generateTerminalOpenScript,
} from './helpers';

describe('helpers utilities', () => {
  describe('slugify', () => {
    it('should convert text to lowercase slug', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should remove brackets prefix', () => {
      expect(slugify('[Bug] Fix login issue')).toBe('fix-login-issue');
      expect(slugify('[FAQ] How to reset password')).toBe('how-to-reset-password');
    });

    it('should remove special characters', () => {
      expect(slugify('Fix: issue #123!')).toBe('fix-issue-123');
    });

    it('should remove duplicate consecutive words', () => {
      expect(slugify('[FAQ] FAQ question')).toBe('faq-question');
    });

    it('should limit slug to 30 characters', () => {
      const longTitle = 'This is a very long issue title that should be truncated';
      expect(slugify(longTitle).length).toBeLessThanOrEqual(30);
    });
  });

  describe('generateITermOpenScript', () => {
    it('should generate valid AppleScript for iTerm', () => {
      const script = generateITermOpenScript('/path/to/script.sh');

      expect(script).toContain('tell application "iTerm"');
      expect(script).toContain('create window with default profile command');
    });

    it('should use create window with command to avoid session restoration', () => {
      const script = generateITermOpenScript('/path/to/script.sh');

      // Should use command parameter to run directly without session restoration
      expect(script).toContain('create window with default profile command');
      expect(script).toContain('/bin/bash -c');
    });

    it('should use /bin/bash to run the script', () => {
      const script = generateITermOpenScript('/path/to/script.sh');

      expect(script).toContain('/bin/bash');
      expect(script).toContain('/path/to/script.sh');
    });

    it('should handle double quotes in script path without breaking AppleScript', () => {
      const script = generateITermOpenScript('/path/to/"quoted"/script.sh');

      // Should still contain the path and be valid AppleScript structure
      expect(script).toContain('tell application "iTerm"');
      expect(script).toContain('/bin/bash');
      expect(script).toContain('quoted');
    });

    it('should handle paths with spaces', () => {
      const script = generateITermOpenScript('/path/with spaces/script.sh');

      expect(script).toContain('/path/with spaces/script.sh');
    });
  });

  describe('generateTerminalOpenScript', () => {
    it('should generate valid AppleScript for Terminal.app', () => {
      const script = generateTerminalOpenScript('/path/to/script.sh');

      expect(script).toContain('tell application "Terminal"');
      expect(script).toContain('do script');
    });

    it('should send "n" to dismiss oh-my-zsh update prompts', () => {
      const script = generateTerminalOpenScript('/path/to/script.sh');

      expect(script).toContain('n;');
    });

    it('should use /bin/bash to run the script', () => {
      const script = generateTerminalOpenScript('/path/to/script.sh');

      expect(script).toContain('/bin/bash');
      expect(script).toContain('/path/to/script.sh');
    });

    it('should handle double quotes in script path without breaking AppleScript', () => {
      const script = generateTerminalOpenScript('/path/to/"quoted"/script.sh');

      // Should still contain the path and be valid AppleScript structure
      expect(script).toContain('tell application "Terminal"');
      expect(script).toContain('/bin/bash');
      expect(script).toContain('quoted');
    });

    it('should handle paths with spaces', () => {
      const script = generateTerminalOpenScript('/path/with spaces/script.sh');

      expect(script).toContain('/path/with spaces/script.sh');
    });
  });

  describe('oh-my-zsh bypass behavior', () => {
    it('iTerm script should run command directly to avoid session restoration', () => {
      const script = generateITermOpenScript('/test/script.sh');

      // Should use create window with command to avoid session restoration issues
      expect(script).toContain('create window with default profile command');
      expect(script).toContain('/bin/bash');
    });

    it('Terminal script should combine dismiss and command in single do script', () => {
      const script = generateTerminalOpenScript('/test/script.sh');

      // Should have "n; /bin/bash..." in a single do script call
      expect(script).toMatch(/do script "n;.*\/bin\/bash/);
    });
  });

  describe('working directory for terminal closing', () => {
    it('iTerm script should cd to script directory before running', () => {
      const script = generateITermOpenScript('/path/to/worktree/.claude-runner.sh');

      // Should cd to the script's directory
      expect(script).toContain('cd "/path/to/worktree"');
      expect(script).toContain('/bin/bash');
    });

    it('Terminal script should cd to script directory before running', () => {
      const script = generateTerminalOpenScript('/path/to/worktree/.claude-runner.sh');

      // Should cd to the script's directory first (quotes are escaped in AppleScript)
      expect(script).toContain('cd \\"/path/to/worktree\\"');
      expect(script).toContain('/bin/bash');
    });

    it('should handle script paths with quotes', () => {
      const script = generateITermOpenScript('/path/to/work"tree/.script.sh');

      expect(script).toContain('/bin/bash');
      // Path should be escaped
      expect(script).toContain('work');
    });
  });
});
