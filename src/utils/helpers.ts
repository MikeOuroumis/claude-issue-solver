import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function checkRequirements(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    missing.push('gh (GitHub CLI) - Install: brew install gh');
  }

  try {
    execSync('claude --version', { stdio: 'pipe' });
  } catch {
    missing.push('claude (Claude Code CLI) - Install: npm install -g @anthropic-ai/claude-code');
  }

  return { ok: missing.length === 0, missing };
}

export function openInNewTerminal(script: string): void {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS - try iTerm2 first, then Terminal
    const iTermScript = `
      tell application "iTerm"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "${script.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;

    const terminalScript = `
      tell application "Terminal"
        activate
        do script "${script.replace(/"/g, '\\"')}"
      end tell
    `;

    try {
      // Check if iTerm is installed
      if (fs.existsSync('/Applications/iTerm.app')) {
        execSync(`osascript -e '${iTermScript}'`, { stdio: 'pipe' });
      } else {
        execSync(`osascript -e '${terminalScript}'`, { stdio: 'pipe' });
      }
    } catch {
      // Fallback to Terminal
      try {
        execSync(`osascript -e '${terminalScript}'`, { stdio: 'pipe' });
      } catch {
        console.log('Could not open new terminal. Run manually:');
        console.log(script);
      }
    }
  } else if (platform === 'linux') {
    // Linux - try common terminal emulators
    const terminals = ['gnome-terminal', 'xterm', 'konsole'];
    for (const term of terminals) {
      try {
        execSync(`which ${term}`, { stdio: 'pipe' });
        if (term === 'gnome-terminal') {
          spawn(term, ['--', 'bash', '-c', script], { detached: true });
        } else {
          spawn(term, ['-e', script], { detached: true });
        }
        return;
      } catch {
        continue;
      }
    }
    console.log('Could not detect terminal emulator. Run manually:');
    console.log(script);
  } else {
    console.log('Unsupported platform. Run manually:');
    console.log(script);
  }
}

export function copyEnvFiles(from: string, to: string): void {
  const envFiles = ['.env', '.env.local'];
  for (const file of envFiles) {
    const src = path.join(from, file);
    const dest = path.join(to, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

export function symlinkNodeModules(from: string, to: string): void {
  const src = path.join(from, 'node_modules');
  const dest = path.join(to, 'node_modules');
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.symlinkSync(src, dest);
  }
}
