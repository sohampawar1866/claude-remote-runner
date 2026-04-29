#!/usr/bin/env node

import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { Command } from 'commander';
import crypto from 'crypto';
import { getOrGenerateConfig } from '../src/config/index.js';
import { logPromptToAppwrite, fetchResponseFromAppwrite, isBackendConfigured, pollForPairing, FRONTEND_URL } from '../src/services/appwrite.js';
import { sendNtfyAlert } from '../src/services/ntfy.js';
import { startKeepAwake, stopKeepAwake } from '../src/utils/keepawake.js';
import { PauseDetector, STATE } from '../src/detection/index.js';
import { installHook, watchStateFile } from '../src/detection/hookSetup.js';
import { createWebRTCSession, sendTerminalChunk } from '../src/services/webrtc.js';
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
  } catch {
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
            } catch {
              continue; // Skip if not executable
            }
          }
          return fullPath;
        }
      }
    } catch {
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
  .version('3.0.0');

program
  .command('doctor')
  .description('Run diagnostics to check environment and configuration')
  .action(() => {
    console.log('\x1b[36m[remote-claude] Diagnostics\x1b[39m\n');
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
  .option('-d, --debug', 'Enable debug logging for pause detection')
  .option('--silence-threshold <ms>', 'Silence threshold in ms before fallback pause detection', '3000')
  .option('--pattern-debounce <ms>', 'Pattern match debounce in ms', '1500')
  .option('--no-hooks', 'Disable automatic Claude Code hook installation')
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
const sessionUrl = `${frontendUrl}/?c=${channelId}&k=${encryptionKey}&n=${config.ntfyTopic}`;
console.log(`\x1b[36m${sessionUrl}\x1b[39m\n`);

qrcode.generate(sessionUrl, { small: true }, (code) => {
  console.log(code);
});

let webrtcChannel = null;
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
      : ['-c', `"${absoluteCmdPath}" ${cmdArgs.map(a => `"${a.replace(/"/g, '\\\\"')}"`).join(' ')}`];
      
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

// ─── Pause Detection Engine ──────────────────────────────────────
// 4-layer hybrid system:
//   Layer 1: Hook-based IPC (optional, highest reliability)
//   Layer 2: Expanded pattern matching (15+ patterns from CCManager)
//   Layer 3: Silence-based fallback (universal safety net)
//   Layer 4: State machine (context tracking)
// ─────────────────────────────────────────────────────────────────

let isWaitingForRemote = false;
let responseUnsubscribe = null;
let hookCleanup = null;
let hookWatchCleanup = null;

// Initialize the PauseDetector with configurable thresholds
const detector = new PauseDetector({
  silenceThresholdMs: parseInt(options.silenceThreshold, 10) || 3000,
  patternDebounceMs: parseInt(options.patternDebounce, 10) || 1500,
  debug: options.debug || false,

  // Called when Claude is confirmed paused and waiting for input
  onPause: (buffer) => {
    onClaudePaused(buffer);
  },

  // Called when Claude resumes after user responds
  onResume: () => {
    if (options.debug) console.log('\x1b[90m[PauseDetector] Claude resumed.\x1b[39m');
  },

  // Called on every state transition
  onStateChange: (newState, oldState) => {
    if (options.debug) {
      console.log(`\x1b[90m[PauseDetector] ${oldState} → ${newState}\x1b[39m`);
    }
  },
});

// ── WebRTC Initialization ────────────────────────────────────────
// Pass lifecycle hooks so the WebRTC module can interact with the PTY
// and detector without circular imports.
if (isBackendConfigured) {
  createWebRTCSession(channelId, encryptionKey, frontendUrl, {
    onMessage: (text) => {
      ptyProcess.write(text);
      if (isWaitingForRemote) cancelRemoteWait();
      detector.userResponded();
    },
    onResize: (dims) => {
      if (options.debug) console.log(`\x1b[90m[WebRTC] Mobile requested resize: ${dims.cols}x${dims.rows}\x1b[39m`);
      try {
        if (dims.cols > 0 && dims.rows > 0) {
          ptyProcess.resize(dims.cols, dims.rows);
        }
      } catch (err) {
        if (options.debug) console.warn(`\x1b[33m[WebRTC] Failed to resize PTY: ${err.message}\x1b[39m`);
      }
    },
    getBuffer: () => detector.buffer,
    ptyProcess: ptyProcess,
  })
    .then(({ peer, dataChannel }) => {
      webrtcChannel = dataChannel;
    })
    .catch(() => {
      console.error('\x1b[31m[WebRTC] Failed to initialize P2P tunnel. Falling back to polling.\x1b[39m');
      qrcode.generate(sessionUrl, { small: true });
      pollForPairing(channelId);
    });
}

// ── Layer 1: Hook-Based IPC (optional) ───────────────────────────
// Install Claude Code lifecycle hooks for the most reliable detection.
// Falls back gracefully if hooks can't be installed.
if (options.hooks !== false) {
  const hookResult = installHook(channelId);
  if (hookResult) {
    hookCleanup = hookResult.cleanup;

    // Watch the state file for hook signals
    hookWatchCleanup = watchStateFile(hookResult.stateFilePath, (signal) => {
      if (options.debug) {
        console.log(`\x1b[90m[Hook] Received signal: ${signal}\x1b[39m`);
      }
      if (signal === 'Notification' || signal === 'Stop') {
        // Claude has stopped or is waiting — force a pause check
        detector.forceTransition(STATE.PAUSED);
      }
    });
  }
}

// Handle terminal resizing
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows);
});

// ── Pipe PTY output to the real terminal + feed the detector ─────
ptyProcess.onData((data) => {
  process.stdout.write(data);

  // Feed every chunk into the PauseDetector.
  detector.feedData(data);

  // Stream output to WebRTC via JSON protocol (Phase 3)
  sendTerminalChunk(webrtcChannel, data);
});

// ── Pass user input to the PTY ───────────────────────────────────
process.stdin.on('data', (data) => {
  ptyProcess.write(data);
  // If we were waiting for remote input, cancel it because the user typed locally
  if (isWaitingForRemote) {
    cancelRemoteWait();
  }
  // Tell the detector the user has responded
  detector.userResponded();
});

// Raw mode allows intercepting keystrokes without needing Enter
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

// ── Pause Handler ────────────────────────────────────────────────
function onClaudePaused(buffer) {
  isWaitingForRemote = true;

  // Clean up prompt text for the push notification
  const cleanBuffer = stripAnsi(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  // Grab the last 8 lines for context so the notification shows the actual question asked
  const lines = cleanBuffer.split('\n');
  const contextLines = lines.slice(Math.max(lines.length - 8, 0)).join('\n');

  // Push notification and DB fallback prompt
  sendNtfyAlert(config.ntfyTopic, 'Claude Needs Input', 'Tap here to securely view the prompt and respond.', channelId, encryptionKey, frontendUrl, isBackendConfigured);
  logPromptToAppwrite(channelId, contextLines, encryptionKey);

  // Phase 2: Poll for responses (Node SDK doesn't support Realtime WebSockets)
  if (!responseUnsubscribe) {
    const pollInterval = setInterval(async () => {
      const responseText = await fetchResponseFromAppwrite(channelId, encryptionKey);
      if (responseText) {
        ptyProcess.write(`${responseText}\r`);
        cancelRemoteWait();
        detector.userResponded();
      }
    }, 1500);

    responseUnsubscribe = () => clearInterval(pollInterval);
  }
}

function cancelRemoteWait() {
  isWaitingForRemote = false;
  if (responseUnsubscribe) {
    responseUnsubscribe();
    responseUnsubscribe = null;
  }
}

// ── Handle exit — clean up hooks and notify mobile ──────────────
ptyProcess.onExit(async ({ exitCode }) => {
  cancelRemoteWait();
  detector.destroy();
  stopKeepAwake();
  if (hookCleanup) hookCleanup();
  if (hookWatchCleanup) hookWatchCleanup();
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
