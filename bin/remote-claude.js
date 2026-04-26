#!/usr/bin/env node

import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { Command } from 'commander';
import crypto from 'crypto';
import { getOrGenerateConfig } from '../src/config/index.js';
import { logPromptToAppwrite, fetchResponseFromAppwrite, isBackendConfigured, pollForPairing, FRONTEND_URL } from '../src/services/appwrite.js';
import { sendNtfyAlert } from '../src/services/ntfy.js';
import { startKeepAwake, stopKeepAwake } from '../src/utils/keepawake.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function fixNodePtyPermissions() {
  try {
    const nodePtyIndex = require.resolve('node-pty');
    const nodePtyDir = path.dirname(path.dirname(nodePtyIndex));
    const prebuildsDir = path.join(nodePtyDir, 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
      const platforms = fs.readdirSync(prebuildsDir);
      for (const platform of platforms) {
        const helperPath = path.join(prebuildsDir, platform, 'spawn-helper');
        if (fs.existsSync(helperPath)) {
          const stat = fs.statSync(helperPath);
          if ((stat.mode & 0o111) === 0) {
            fs.chmodSync(helperPath, 0o755);
            console.log(`[remote-claude] Automatically fixed execute permissions for node-pty spawn-helper`);
          }
        }
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

fixNodePtyPermissions();

// Function to explicitly locate the absolute path of the claude binary
function findClaudeBinary(cmdName = 'claude') {
  const isWin = process.platform === 'win32';
  const binName = isWin && !cmdName.endsWith('.cmd') && !cmdName.endsWith('.exe') ? `${cmdName}.cmd` : cmdName;
  
  const envPaths = (process.env.PATH || '').split(isWin ? ';' : ':');
  const home = os.homedir();
  
  let commonPaths = [];
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    commonPaths = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'Programs', 'claude'),
      path.join(home, 'AppData', 'Roaming', 'npm'),
      'C:\\Windows\\System32',
      'C:\\Windows',
    ];
  } else {
    commonPaths = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ];
  }
  
  const allPaths = [...new Set([...envPaths, ...commonPaths])].filter(Boolean);
  
  for (const dir of allPaths) {
    try {
      const fullPath = path.join(dir, binName);
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          // On non-Windows, ensure it has execute permissions
          if (!isWin) {
            try {
              fs.accessSync(fullPath, fs.constants.X_OK);
              return fullPath;
            } catch (err) {
              continue; // Skip if not executable
            }
          }
          return fullPath;
        }
      }
    } catch (e) {
      // Ignore directory read errors
    }
  }
  return null;
}

process.on('uncaughtException', (err) => {
  // Only treat as "not found" if it's truly ENOENT (binary missing)
  if (err.code === 'ENOENT') {
    console.error('\n\x1b[31m[remote-claude] Error: Could not find the `claude` command.\x1b[39m');
    console.error('Please install Claude Code first: https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview');
    console.error('Then re-run: \x1b[36mremote-claude\x1b[39m\n');
  } else {
    console.error('\n\x1b[31m[remote-claude] Error:\x1b[39m', err.message);
    console.error('Code:', err.code || 'none');
    console.error('If this persists, report: \x1b[34mhttps://github.com/sohampawar1866/claude-remote-runner/issues\x1b[39m');
  }
  process.exit(1);
});

const program = new Command();

program
  .name('remote-claude')
  .description('A CLI wrapper for Claude Code to enable remote interactions')
  .version('1.4.0');

program
  .command('doctor')
  .description('Run diagnostics to check environment and configuration')
  .action(() => {
    console.log('\\x1b[36m[remote-claude] Diagnostics\\x1b[39m\\n');
    console.log(`Node Version: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 16 ? '✅' : '❌ (Requires >=16)'}`);
    console.log(`Appwrite Configured: ${isBackendConfigured ? '✅' : '❌ (Check .env)'}`);
    console.log(`PTY Available: ✅`);
    process.exit(0);
  });

program
  .command('reset')
  .description('Clear configuration')
  .action(() => {
    const configDir = path.join(os.homedir(), '.remote-claude');
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
      console.log('✅ Configuration cleared.');
    }
    process.exit(0);
  });

program
  .command('start', { isDefault: true })
  .description('Start the Claude remote runner (default)')
  .option('-c, --command <cmd>', 'Command to run', 'claude')
  .option('-k, --keep-awake', 'Prevent the system from sleeping while running')
  .argument('[args...]', 'Arguments to pass to the command')
  .action((args, options) => {
    startRunner(args, options);
  });

program.parse(process.argv);

function startRunner(args, options) {
  const config = getOrGenerateConfig();
// E2E Encryption setup
const channelId = crypto.randomUUID();
const encryptionKey = crypto.randomBytes(32).toString('hex');
const frontendUrl = FRONTEND_URL;

// Keep-awake: prevent system sleep during long agent tasks
if (options.keepAwake) {
  startKeepAwake();
  console.log('\x1b[33m[remote-claude] Keep-awake enabled - system will not sleep.\x1b[39m');
}

console.log('\x1b[36m[remote-claude] Active Session URL:\x1b[39m');
const sessionUrl = `${frontendUrl}/?c=${channelId}&k=${encryptionKey}`;
console.log(`\x1b[36m${sessionUrl}\x1b[39m\n`);

if (isBackendConfigured) {
  qrcode.generate(sessionUrl, { small: true });
  pollForPairing(channelId);
}

// Extract the base command and any additional arguments
const cmdName = options.command;
const cmdArgs = args.length > 0 ? args : [];

console.log(`[remote-claude] Starting ${cmdName} ${cmdArgs.join(' ')}...`);

const absoluteCmdPath = findClaudeBinary(cmdName);

if (!absoluteCmdPath) {
  const error = new Error(`Command not found: ${cmdName}`);
  error.code = 'ENOENT';
  throw error;
}

// Build spawn env
const spawnEnv = {
  ...process.env,
  TERM: 'xterm-256color',
};

const ptyOptions = {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: process.cwd(),
  env: spawnEnv,
};

let ptyProcess;

// Fallback chain for robust spawning across all OS and Node configurations
try {
  if (options.debug) console.log(`[DEBUG] Attempting direct absolute spawn: ${absoluteCmdPath}`);
  ptyProcess = pty.spawn(absoluteCmdPath, cmdArgs, ptyOptions);
} catch (err1) {
  if (options.debug) console.warn(`[DEBUG] Direct spawn failed: ${err1.message}. Retrying via shell...`);
  
  try {
    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
    const shellArgs = isWin 
      ? ['/d', '/c', `"${absoluteCmdPath}" ${cmdArgs.join(' ')}`]
      : ['-c', `"${absoluteCmdPath}" ${cmdArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`];
      
    if (options.debug) console.log(`[DEBUG] Attempting shell spawn: ${shell} ${shellArgs.join(' ')}`);
    ptyProcess = pty.spawn(shell, shellArgs, ptyOptions);
  } catch (err2) {
    if (options.debug) console.warn(`[DEBUG] Shell spawn failed: ${err2.message}. Retrying generic PATH lookup...`);
    
    try {
      ptyProcess = pty.spawn(cmdName, cmdArgs, ptyOptions);
    } catch (err3) {
      console.error('\x1b[31m[remote-claude] Critical spawn failure.\x1b[39m');
      console.error('1. Direct:', err1.message);
      console.error('2. Shell:', err2.message);
      console.error('3. Generic:', err3.message);
      throw err3;
    }
  }
}

// Buffer to hold output for detection
let outputBuffer = '';
let pauseTimeout = null;
const PAUSE_THRESHOLD_MS = 1500; // Time to wait after detecting a prompt pattern

// Regex patterns to match Claude Code's interactive prompts
// e.g. "? Do you want to run this command? (Y/n)" or "> "
const PROMPT_PATTERNS = [
  /(?:\?.*\(Y\/n\).*|>\s*)$/i, // Basic Yes/No or prompt
];

// Handle terminal resizing
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// Pipe PTY output to the real terminal
ptyProcess.onData((data) => {
  process.stdout.write(data);
  
  // Accumulate data
  outputBuffer += data;
  
  // Clear any existing timeout since we are receiving new data
  if (pauseTimeout) {
    clearTimeout(pauseTimeout);
    pauseTimeout = null;
  }
  
  // Check if the current buffer ends with a prompt pattern
  const stripped = stripAnsi(outputBuffer);
  
  // We only check the end of the buffer (or the last few lines)
  const lines = stripped.split('\n');
  const lastLine = lines[lines.length - 1] || '';
  
  const isMatch = PROMPT_PATTERNS.some((pattern) => pattern.test(lastLine.trimEnd()));
  
  if (isMatch) {
    // If it looks like a prompt, wait a bit to see if Claude is actually paused
    pauseTimeout = setTimeout(() => {
      onClaudePaused(outputBuffer);
    }, PAUSE_THRESHOLD_MS);
  }
  
  // Keep buffer size manageable
  if (outputBuffer.length > 10000) {
    outputBuffer = outputBuffer.slice(-5000);
  }
});

// Pass user input to the PTY
process.stdin.on('data', (data) => {
  ptyProcess.write(data);
  // If we were waiting for remote input, cancel it because the user typed locally
  if (isWaitingForRemote) {
    cancelRemoteWait();
  }
});

// Raw mode allows intercepting keystrokes without needing Enter
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

let isWaitingForRemote = false;
let pollingInterval = null;

function onClaudePaused(buffer) {
  isWaitingForRemote = true;
  
  // Clean up prompt text for the push notification
  const cleanBuffer = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  // Grab the last 5 lines for context so the notification shows the actual question asked
  const lines = cleanBuffer.split('\n');
  const contextLines = lines.slice(Math.max(lines.length - 5, 0)).join('\n');
  
  // Trigger Phase 2 Backend Sync
  sendNtfyAlert(config.ntfyTopic, 'Claude Needs Input', 'Tap here to securely view the prompt and respond.', channelId, encryptionKey, frontendUrl, isBackendConfigured);
  logPromptToAppwrite(channelId, contextLines, encryptionKey); 

  // Start polling Appwrite for a response
  if (!pollingInterval) {
    pollingInterval = setInterval(async () => {
      if (!isWaitingForRemote) return;
      
      const response = await fetchResponseFromAppwrite(channelId, encryptionKey);
      if (response !== null) {
        // We got a response from the mobile app!
        ptyProcess.write(`${response}\r`);
        cancelRemoteWait();
      }
    }, 1000); // Poll every 1 second
  }
}

function cancelRemoteWait() {
  isWaitingForRemote = false;
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Handle exit - notify the mobile app that this session is done
ptyProcess.onExit(async ({ exitCode, signal }) => {
  cancelRemoteWait();
  stopKeepAwake();
  await logPromptToAppwrite(channelId, '[remote-claude] Process exited.', encryptionKey, 'disconnect');
  process.exit(exitCode);
});

// Forward signals
process.on('SIGINT', () => {
  ptyProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  ptyProcess.kill('SIGTERM');
});

} // end startRunner
