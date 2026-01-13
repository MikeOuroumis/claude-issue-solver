import { execSync } from 'child_process';
import * as os from 'os';

export interface CloseTerminalOptions {
  folderPath: string;
  issueNumber: string;
  prNumber?: string;
}

/**
 * Generates search patterns for matching terminal windows/sessions
 */
export function getSearchPatterns(options: CloseTerminalOptions): string[] {
  const { folderPath, issueNumber, prNumber } = options;
  const folderName = folderPath.split('/').pop() || '';

  const patterns: string[] = [];

  // Folder name pattern (e.g., "project-issue-38-slug")
  if (folderName) {
    patterns.push(folderName);
  }

  // Issue pattern (e.g., "Issue #38")
  patterns.push(`Issue #${issueNumber}`);

  // Branch pattern (e.g., "issue-38-")
  patterns.push(`issue-${issueNumber}-`);

  // PR pattern if provided
  if (prNumber) {
    patterns.push(`PR #${prNumber}`);
    patterns.push(`Review PR #${prNumber}`);
  }

  return patterns;
}

/**
 * Generate AppleScript to close iTerm2 windows/tabs matching patterns
 * Uses a two-pass approach: first collect IDs, then close them
 */
export function generateITermCloseScript(patterns: string[]): string {
  // Escape patterns for AppleScript string comparison
  const escapedPatterns = patterns.map((p) => p.replace(/"/g, '\\"'));

  return `
tell application "iTerm"
  set windowsToClose to {}
  set sessionsToClose to {}

  -- First pass: collect windows and sessions to close
  repeat with w in windows
    try
      set windowName to name of w
      set windowId to id of w
      ${escapedPatterns.map((p) => `if windowName contains "${p}" then set end of windowsToClose to windowId`).join('\n      ')}
    end try

    -- Check tabs and sessions
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          set sessionName to name of s
          set sessionId to unique id of s
          ${escapedPatterns.map((p) => `if sessionName contains "${p}" then set end of sessionsToClose to {windowId, sessionId}`).join('\n          ')}
        end try
      end repeat
    end repeat
  end repeat

  -- Second pass: close sessions first (from windows not being fully closed)
  repeat with sessionInfo in sessionsToClose
    try
      set targetWindowId to item 1 of sessionInfo
      set targetSessionId to item 2 of sessionInfo
      -- Only close session if its window isn't being closed entirely
      if windowsToClose does not contain targetWindowId then
        repeat with w in windows
          if id of w is targetWindowId then
            repeat with t in tabs of w
              repeat with s in sessions of t
                if unique id of s is targetSessionId then
                  close s
                end if
              end repeat
            end repeat
          end if
        end repeat
      end if
    end try
  end repeat

  -- Third pass: close entire windows
  repeat with targetWindowId in windowsToClose
    try
      repeat with w in windows
        if id of w is targetWindowId then
          close w
          exit repeat
        end if
      end repeat
    end try
  end repeat
end tell
`;
}

/**
 * Generate AppleScript to close Terminal.app windows matching patterns
 */
export function generateTerminalCloseScript(patterns: string[]): string {
  const escapedPatterns = patterns.map((p) => p.replace(/"/g, '\\"'));
  const conditions = escapedPatterns.map((p) => `windowName contains "${p}"`).join(' or ');

  return `
tell application "Terminal"
  set windowsToClose to {}

  -- First pass: collect window IDs
  repeat with w in windows
    try
      set windowName to name of w
      if ${conditions} then
        set end of windowsToClose to id of w
      end if
    end try
  end repeat

  -- Second pass: close windows by ID
  repeat with targetId in windowsToClose
    try
      repeat with w in windows
        if id of w is targetId then
          close w
          exit repeat
        end if
      end repeat
    end try
  end repeat
end tell
`;
}

/**
 * Generate AppleScript to close VS Code windows matching patterns
 */
export function generateVSCodeCloseScript(patterns: string[]): string {
  const escapedPatterns = patterns.map((p) => p.replace(/"/g, '\\"'));
  const conditions = escapedPatterns.map((p) => `windowName contains "${p}"`).join(' or ');

  return `
tell application "System Events"
  if exists process "Code" then
    tell process "Code"
      set windowsToClose to {}

      -- First pass: collect windows to close
      repeat with w in windows
        try
          set windowName to name of w
          if ${conditions} then
            set end of windowsToClose to w
          end if
        end try
      end repeat

      -- Second pass: close collected windows
      repeat with targetWindow in windowsToClose
        try
          perform action "AXPress" of (first button of targetWindow whose subrole is "AXCloseButton")
          delay 0.2
        end try
      end repeat
    end tell
  end if
end tell
`;
}

/**
 * Execute AppleScript and handle errors gracefully
 */
export function executeAppleScript(script: string, timeout: number = 5000): boolean {
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
      stdio: 'pipe',
      timeout,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Close terminal windows and VS Code windows associated with a worktree
 * Returns an object indicating which applications had windows closed
 */
export function closeWindowsForWorktree(options: CloseTerminalOptions): {
  iTerm: boolean;
  terminal: boolean;
  vscode: boolean;
} {
  if (os.platform() !== 'darwin') {
    return { iTerm: false, terminal: false, vscode: false };
  }

  const patterns = getSearchPatterns(options);

  // Try to close iTerm2 windows/sessions
  const iTermScript = generateITermCloseScript(patterns);
  const iTermResult = executeAppleScript(iTermScript);

  // Try to close Terminal.app windows
  const terminalScript = generateTerminalCloseScript(patterns);
  const terminalResult = executeAppleScript(terminalScript);

  // Try to close VS Code windows
  const vscodeScript = generateVSCodeCloseScript(patterns);
  const vscodeResult = executeAppleScript(vscodeScript, 10000);

  return {
    iTerm: iTermResult,
    terminal: terminalResult,
    vscode: vscodeResult,
  };
}
