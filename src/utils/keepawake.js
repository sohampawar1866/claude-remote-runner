import { spawn, execSync } from 'child_process';
import os from 'os';

let keepAwakeProcess = null;

/**
 * Prevents the system from sleeping while a long-running agent task is active.
 * Cross-platform:
 *   macOS  → caffeinate -di (prevent idle + display sleep)
 *   Linux  → systemd-inhibit (if available), otherwise xdg-screensaver
 *   Windows → PowerShell SetThreadExecutionState loop
 */
export function startKeepAwake() {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      // macOS: caffeinate prevents idle sleep (-i) and display sleep (-d)
      keepAwakeProcess = spawn('caffeinate', ['-di'], {
        stdio: 'ignore',
        detached: false,
      });
    } else if (platform === 'linux') {
      try {
        execSync('which systemd-inhibit', { stdio: 'ignore' });
        keepAwakeProcess = spawn('systemd-inhibit', [
          '--what=idle',
          '--who=remote-claude',
          '--why=Claude agent task in progress',
          'sleep', 'infinity'
        ], {
          stdio: 'ignore',
          detached: false,
        });
      } catch (e) {
        console.warn('\\x1b[33m[remote-claude] Warning: systemd-inhibit not found, falling back to best-effort keep-awake.\\x1b[39m');
        keepAwakeProcess = spawn('xdg-screensaver', ['reset'], { stdio: 'ignore', detached: false });
      }
    } else if (platform === 'win32') {
      // Windows: Continuously call SetThreadExecutionState to prevent sleep
      // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_DISPLAY_REQUIRED (0x00000002)
      const psScript = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class KeepAwake {
            [DllImport("kernel32.dll")]
            public static extern uint SetThreadExecutionState(uint esFlags);
          }
"@
        while ($true) {
          [KeepAwake]::SetThreadExecutionState(0x80000003) | Out-Null
          Start-Sleep -Seconds 30
        }
      `;
      keepAwakeProcess = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
      });
    }

    if (keepAwakeProcess) {
      keepAwakeProcess.on('error', () => {
        // Silently fail - keep-awake is best-effort, not critical
        keepAwakeProcess = null;
      });
      keepAwakeProcess.unref(); // Don't let this block Node exit
    }
  } catch {
    // Platform command not found - skip silently
    keepAwakeProcess = null;
  }
}

/**
 * Re-enables normal system sleep behavior.
 */
export function stopKeepAwake() {
  if (keepAwakeProcess) {
    try {
      keepAwakeProcess.kill();
    } catch {
      // Already dead
    }
    keepAwakeProcess = null;
  }

  // Windows: Reset the execution state back to normal
  if (os.platform() === 'win32') {
    try {
      spawn('powershell', ['-NoProfile', '-Command',
        'Add-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices;\npublic class KeepAwake { [DllImport(\\"kernel32.dll\\")] public static extern uint SetThreadExecutionState(uint esFlags); }\n"@; [KeepAwake]::SetThreadExecutionState(0x80000000)'
      ], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Best effort
    }
  }
}
