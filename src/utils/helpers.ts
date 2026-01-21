import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function slugify(text: string): string {
  // Remove common prefixes in brackets like [FAQ], [Bug], etc.
  const withoutBrackets = text.replace(/^\[.*?\]\s*/, '');

  const slug = withoutBrackets
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Remove duplicate consecutive words (e.g., "faq-faq" -> "faq")
  const words = slug.split('-');
  const deduped = words.filter((word, i) => word !== words[i - 1]);

  return deduped.join('-').slice(0, 30);
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
    // Use /bin/bash explicitly to bypass interactive shell issues (e.g., oh-my-zsh update prompts)
    // Send 'n' first to dismiss any oh-my-zsh update prompt, then run the script
    const escapedScript = script.replace(/"/g, '\\"');
    const bashCommand = `/bin/bash "${escapedScript}"`;

    // For iTerm: send 'n' to dismiss any prompt, wait briefly, then run the command
    const iTermScript = `
      tell application "iTerm"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "n"
          delay 0.3
          write text "${bashCommand.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;

    // For Terminal: combine dismissing prompt and running command
    const terminalScript = `
      tell application "Terminal"
        activate
        do script "n; ${bashCommand.replace(/"/g, '\\"')}"
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

/**
 * Recursively find all .env* files in a directory
 */
function findEnvFiles(dir: string, baseDir: string, results: string[] = []): string[] {
  const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.turbo'];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) {
          findEnvFiles(fullPath, baseDir, results);
        }
      } else if (entry.isFile() && entry.name.startsWith('.env')) {
        // Store relative path from base directory
        const relativePath = path.relative(baseDir, fullPath);
        results.push(relativePath);
      }
    }
  } catch {
    // Ignore permission errors or inaccessible directories
  }

  return results;
}

export function copyEnvFiles(from: string, to: string): void {
  // Find all .env* files recursively
  const envFiles = findEnvFiles(from, from);

  for (const relativePath of envFiles) {
    const src = path.join(from, relativePath);
    const dest = path.join(to, relativePath);

    // Create parent directory if it doesn't exist
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Only copy if destination doesn't exist
    if (!fs.existsSync(dest)) {
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
