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

  // Full folder path (most reliable for working directory matching)
  if (folderPath) {
    patterns.push(folderPath);
  }

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
 * Matches both window names AND session working directories for reliability
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

    -- Check tabs and sessions - match by name OR working directory path
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          set sessionName to name of s
          set sessionPath to ""
          try
            set sessionPath to path of s
          end try
          set sessionId to unique id of s
          -- Match by session name
          ${escapedPatterns.map((p) => `if sessionName contains "${p}" then set end of sessionsToClose to {windowId, sessionId}`).join('\n          ')}
          -- Match by working directory path (more reliable)
          ${escapedPatterns.map((p) => `if sessionPath contains "${p}" then set end of sessionsToClose to {windowId, sessionId}`).join('\n          ')}
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
 * Find and terminate shell processes running in the given directory
 * This is a fallback approach when AppleScript matching fails
 */
export function killProcessesInDirectory(dirPath: string): boolean {
  if (os.platform() !== 'darwin' && os.platform() !== 'linux') {
    return false;
  }

  try {
    // Use lsof to find processes with their current working directory in the target path
    // +D flag finds processes with files open in the directory (including cwd)
    const output = execSync(`lsof +D "${dirPath}" 2>/dev/null || true`, {
      encoding: 'utf8',
      timeout: 5000,
    });

    if (!output.trim()) {
      return false;
    }

    // Parse lsof output to get PIDs of shell processes
    const lines = output.split('\n').slice(1); // Skip header
    const pids = new Set<string>();

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const command = parts[0].toLowerCase();
        const pid = parts[1];
        // Only kill shell processes and their children, not system processes
        if (['bash', 'zsh', 'sh', 'fish', 'claude', 'node'].some(s => command.includes(s))) {
          pids.add(pid);
        }
      }
    }

    // Send SIGTERM to each process
    for (const pid of pids) {
      try {
        execSync(`kill -TERM ${pid} 2>/dev/null || true`, { stdio: 'pipe' });
      } catch {
        // Process may have already exited
      }
    }

    return pids.size > 0;
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
  processes: boolean;
} {
  if (os.platform() !== 'darwin') {
    return { iTerm: false, terminal: false, vscode: false, processes: false };
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

  // Fallback: kill processes running in the worktree directory
  const processResult = killProcessesInDirectory(options.folderPath);

  return {
    iTerm: iTermResult,
    terminal: terminalResult,
    vscode: vscodeResult,
    processes: processResult,
  };
}
