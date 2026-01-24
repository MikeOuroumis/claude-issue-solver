import { execSync, spawn, spawnSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

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

/**
 * Generate AppleScript for opening a script in Terminal.app.
 * Changes to the script's directory first so the session path matches the worktree.
 */
export function generateTerminalOpenScript(script: string): string {
  const escapedScript = script.replace(/"/g, '\\"');
  // Extract directory from script path to set as working directory
  const scriptDir = path.dirname(script.replace(/'/g, ''));
  const escapedDir = scriptDir.replace(/"/g, '\\"');
  // cd to the script's directory first, so session path matches worktree
  const bashCommand = `cd \\"${escapedDir}\\" && /bin/bash \\"${escapedScript}\\"`;

  // Create a new window and run the command in it
  return `tell application "Terminal"
do script "${bashCommand}"
activate
end tell`;
}

export function openInNewTerminal(script: string): void {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS - use Terminal.app (always available, no session restoration issues)
    const terminalScript = generateTerminalOpenScript(script);

    // Use spawnSync with stdin to avoid shell escaping issues
    const result = spawnSync('osascript', [], {
      input: terminalScript,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || '';

      // Check for automation permission error
      if (stderr.includes('-1743') || stderr.includes('Not authorised')) {
        console.log('\n⚠️  macOS automation permission required!\n');
        console.log('To fix this, go to:');
        console.log('  System Settings → Privacy & Security → Automation\n');
        console.log('Then enable "Terminal" for the app you\'re running this from.');
        console.log('\nAfter granting permission, run the command again.\n');
      } else {
        console.log('Could not open new terminal. Run manually:');
      }
      console.log(script);
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
