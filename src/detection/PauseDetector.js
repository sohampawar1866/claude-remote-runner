// src/detection/PauseDetector.js
// 4-layer hybrid pause detection engine for Claude Code terminal output.
//
// Layer 1: Hook-based IPC (highest reliability — optional)
// Layer 2: Pattern matching (primary — expanded regex catalog)
// Layer 3: Silence-based fallback (universal safety net)
// Layer 4: State machine (context tracking — prevents false transitions)

import stripAnsi from 'strip-ansi';
import {
  WAITING_PATTERNS,
  BUSY_PATTERNS,
  IGNORE_PATTERNS,
  SEARCH_PATTERN,
  getRecentBlockAbovePromptBox,
  findPromptBox,
} from './patterns.js';

// ─── State Constants ─────────────────────────────────────────────
export const STATE = Object.freeze({
  IDLE: 'idle',
  BUSY: 'busy',
  PAUSED: 'paused',
});

// ─── Default Thresholds ──────────────────────────────────────────
const DEFAULTS = {
  // How long to wait after a pattern match before confirming pause.
  // Prevents false positives from transient output that looks prompt-like.
  patternDebounceMs: 1500,

  // How long of total silence (no PTY output) before triggering a
  // low-confidence pause check. This is the universal safety net
  // that catches prompts we don't have patterns for.
  silenceThresholdMs: 3000,

  // How long terminal content must remain unchanged before allowing
  // an idle transition. Prevents false idle during screen redraws.
  idleDebounceMs: 1500,

  // Maximum buffer size to keep (characters). Older content is trimmed.
  maxBufferSize: 15000,

  // How many lines from the bottom of the buffer to analyze.
  analysisWindowLines: 40,
};

export class PauseDetector {
  /**
   * @param {Object} options
   * @param {number} [options.patternDebounceMs=1500]
   * @param {number} [options.silenceThresholdMs=3000]
   * @param {number} [options.idleDebounceMs=1500]
   * @param {number} [options.maxBufferSize=15000]
   * @param {number} [options.analysisWindowLines=40]
   * @param {Function} [options.onPause] - Called when Claude is confirmed paused. Receives (cleanBuffer).
   * @param {Function} [options.onResume] - Called when Claude resumes after a pause.
   * @param {Function} [options.onStateChange] - Called on every state transition. Receives (newState, oldState).
   * @param {boolean} [options.debug=false] - Enable debug logging.
   */
  constructor(options = {}) {
    this._opts = { ...DEFAULTS, ...options };
    this._state = STATE.IDLE;
    this._buffer = '';
    this._lastOutputTime = 0;
    this._lastContentHash = '';
    this._contentStableSince = 0;

    // Callbacks
    this._onPause = options.onPause ?? (() => {});
    this._onResume = options.onResume ?? (() => {});
    this._onStateChange = options.onStateChange ?? (() => {});
    this._debug = options.debug ?? false;

    // Timers
    this._patternTimer = null;
    this._silenceTimer = null;

    // Track whether we've already fired a pause for the current prompt.
    // Prevents duplicate notifications when the same prompt stays on screen.
    this._pauseFiredForHash = null;
  }

  /** Current detector state. */
  get state() {
    return this._state;
  }

  /** Current buffer contents (raw, with ANSI). */
  get buffer() {
    return this._buffer;
  }

  /**
   * Feed new PTY data into the detector.
   * Call this from ptyProcess.onData().
   *
   * @param {string} rawData - Raw data chunk from the PTY (may contain ANSI).
   */
  feedData(rawData) {
    // Accumulate into buffer
    this._buffer += rawData;
    this._lastOutputTime = Date.now();

    // Trim buffer to prevent unbounded growth
    if (this._buffer.length > this._opts.maxBufferSize) {
      this._buffer = this._buffer.slice(-Math.floor(this._opts.maxBufferSize / 2));
    }

    // Clear any pending timers — new data means the situation is changing
    this._clearTimers();

    // Analyze the current buffer state
    const stripped = stripAnsi(this._buffer);
    const analysisResult = this._analyze(stripped);

    this._debugLog(`feedData: analysis=${analysisResult}, currentState=${this._state}`);

    switch (analysisResult) {
      case 'waiting_input': {
        // High-confidence match — debounce briefly to confirm it's stable
        const contentHash = this._hashContent(stripped);
        this._patternTimer = setTimeout(() => {
          // Re-check: is the buffer still the same? (no new output arrived)
          const currentStripped = stripAnsi(this._buffer);
          const currentHash = this._hashContent(currentStripped);
          if (currentHash === contentHash) {
            this._triggerPause();
          }
        }, this._opts.patternDebounceMs);
        break;
      }

      case 'busy': {
        this._transition(STATE.BUSY);
        break;
      }

      case 'ignore': {
        // Maintain current state — don't start any timers
        break;
      }

      default: {
        // No clear signal from patterns.
        // Start the silence timer — if no more output arrives within the
        // threshold, run a low-confidence pause check.
        this._silenceTimer = setTimeout(() => {
          this._onSilence();
        }, this._opts.silenceThresholdMs);
        break;
      }
    }
  }

  /**
   * Signal that the user has responded (locally or remotely).
   * Resets the detector to IDLE and cancels any pending timers.
   */
  userResponded() {
    this._clearTimers();
    this._pauseFiredForHash = null;
    if (this._state === STATE.PAUSED) {
      this._transition(STATE.IDLE);
      this._onResume();
    }
  }

  /**
   * Force a transition to PAUSED state.
   * Used by the hook-based IPC layer when it receives a Notification signal.
   */
  forceTransition(newState) {
    if (newState === STATE.PAUSED) {
      this._triggerPause();
    } else {
      this._transition(newState);
    }
  }

  /**
   * Clean up timers. Call when the PTY process exits.
   */
  destroy() {
    this._clearTimers();
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze the stripped terminal buffer and return a classification:
   * 'waiting_input' | 'busy' | 'ignore' | null
   */
  _analyze(stripped) {
    const lines = stripped.split('\n');
    const tailLines = lines.slice(-this._opts.analysisWindowLines);
    const fullContent = tailLines.join('\n');
    const fullLower = fullContent.toLowerCase();

    // ── Priority 1: Search mode overrides everything → idle (not paused)
    if (SEARCH_PATTERN.test(fullContent)) {
      return null; // Will fall through to silence timer, which is correct
    }

    // ── Priority 2: IGNORE patterns → maintain current state
    for (const { pattern } of IGNORE_PATTERNS) {
      if (pattern.test(fullLower)) {
        return 'ignore';
      }
    }

    // ── Priority 3: WAITING_INPUT patterns (checked against full buffer)
    for (const entry of WAITING_PATTERNS) {
      if (entry.requiresContext) {
        // Medium-confidence patterns need additional structural evidence
        if (entry.pattern.test(fullLower) && this._hasPromptStructure(tailLines)) {
          return 'waiting_input';
        }
        continue;
      }
      if (entry.pattern.test(fullContent)) {
        return 'waiting_input';
      }
    }

    // ── Priority 4: BUSY patterns (checked ONLY above the prompt box)
    const recentBlock = getRecentBlockAbovePromptBox(tailLines);
    if (recentBlock) {
      const recentLower = recentBlock.toLowerCase();
      for (const { pattern } of BUSY_PATTERNS) {
        if (pattern.test(recentBlock) || pattern.test(recentLower)) {
          return 'busy';
        }
      }
    }

    // ── No clear signal
    return null;
  }

  /**
   * Check if the terminal output has structural evidence of a prompt:
   * - A prompt box (──── borders with ❯ between them)
   * - Numbered options with ❯ cursor
   */
  _hasPromptStructure(lines) {
    const box = findPromptBox(lines);
    if (box) return true;

    // Check for numbered menu with cursor
    const joined = lines.join('\n');
    if (/❯\s*\d+\.\s+/.test(joined)) return true;

    return false;
  }

  /**
   * Called when the silence timer fires (no PTY output for silenceThresholdMs).
   * Runs a low-confidence pause check.
   */
  _onSilence() {
    this._debugLog(`_onSilence: state=${this._state}`);

    // Don't fire pause if we're already paused
    if (this._state === STATE.PAUSED) return;

    // If we're in BUSY state, check if the busy indicators are gone
    const stripped = stripAnsi(this._buffer);
    const lines = stripped.split('\n');
    const tailLines = lines.slice(-this._opts.analysisWindowLines);
    const recentBlock = getRecentBlockAbovePromptBox(tailLines);

    if (recentBlock) {
      const recentLower = recentBlock.toLowerCase();
      for (const { pattern } of BUSY_PATTERNS) {
        if (pattern.test(recentBlock) || pattern.test(recentLower)) {
          // Still has busy indicators — don't trigger pause
          this._debugLog('_onSilence: still busy, restarting silence timer');
          this._silenceTimer = setTimeout(() => {
            this._onSilence();
          }, this._opts.silenceThresholdMs);
          return;
        }
      }
    }

    // No busy indicators + prolonged silence = likely paused.
    // Check for any structural prompt evidence to boost confidence.
    const hasPrompt = this._hasPromptStructure(tailLines);
    const fullContent = tailLines.join('\n');

    if (hasPrompt) {
      this._debugLog('_onSilence: prompt structure detected, triggering pause');
      this._triggerPause();
    } else {
      // Even without prompt structure, if output has been completely silent
      // for the threshold AND we were previously busy, this is likely a
      // transition to waiting. Use a longer debounce for safety.
      const timeSinceOutput = Date.now() - this._lastOutputTime;
      if (timeSinceOutput >= this._opts.silenceThresholdMs && this._state === STATE.BUSY) {
        this._debugLog('_onSilence: extended silence after busy state, triggering pause');
        this._triggerPause();
      } else {
        // Truly idle — no action needed
        this._transition(STATE.IDLE);
      }
    }
  }

  /**
   * Trigger a confirmed pause — fire the callback and transition state.
   */
  _triggerPause() {
    // Prevent duplicate notifications for the same prompt content
    const stripped = stripAnsi(this._buffer);
    const hash = this._hashContent(stripped);
    if (this._pauseFiredForHash === hash) {
      this._debugLog('_triggerPause: duplicate hash, skipping');
      return;
    }

    this._pauseFiredForHash = hash;
    this._transition(STATE.PAUSED);
    this._onPause(this._buffer);
  }

  /**
   * Transition to a new state and fire the state change callback.
   */
  _transition(newState) {
    if (this._state === newState) return;
    const oldState = this._state;
    this._state = newState;
    this._debugLog(`STATE: ${oldState} → ${newState}`);
    this._onStateChange(newState, oldState);
  }

  /**
   * Clear all pending timers.
   */
  _clearTimers() {
    if (this._patternTimer) {
      clearTimeout(this._patternTimer);
      this._patternTimer = null;
    }
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  /**
   * Simple hash of the last N characters of content for deduplication.
   */
  _hashContent(content) {
    // Use the last 500 chars as a fingerprint — cheap but effective
    return content.slice(-500);
  }

  /**
   * Debug logger.
   */
  _debugLog(msg) {
    if (this._debug) {
      console.log(`\x1b[90m[PauseDetector] ${msg}\x1b[39m`);
    }
  }
}
