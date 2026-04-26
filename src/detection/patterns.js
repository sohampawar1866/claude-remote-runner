// src/detection/patterns.js
// Comprehensive pattern catalog for Claude Code v2.x terminal output detection.
// Derived from CCManager (kbwo/ccmanager) and direct Claude Code analysis.

// ─────────────────────────────────────────────────────────────────
// Spinner characters used by Claude Code's activity indicators.
// Includes ornament spinners, bullets (· • ∙ ⋅), record (⏺),
// triangles (▸▹), circles (○●), and decorative stars/asterisks.
// ─────────────────────────────────────────────────────────────────
const SPINNER_CHARS =
  '✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❇❈❉❊❋✢✣✤✥✦✧✨⊛⊕⊙◉◎◍⁂⁕※⍟☼★☆·•⏺▸▹∙⋅○●';

// ─────────────────────────────────────────────────────────────────
// WAITING_INPUT patterns — checked against the FULL terminal buffer.
// A match means Claude is paused and waiting for user interaction.
// ─────────────────────────────────────────────────────────────────
export const WAITING_PATTERNS = [
  // "Do you want …" or "Would you like …" followed by options/cursor
  // e.g. "Do you want to make this edit?\n❯ 1. Yes\n  2. No"
  {
    name: 'do_you_want_options',
    pattern: /(?:do you want|would you like).+\n+[\s\S]*?(?:yes|❯)/i,
    confidence: 'high',
  },

  // "esc to cancel" — universal waiting indicator across Claude Code UIs
  {
    name: 'esc_to_cancel',
    pattern: /esc to cancel/i,
    confidence: 'high',
  },

  // Classic "? Question text (Y/n)" format (older Claude Code / Inquirer.js style)
  {
    name: 'y_n_prompt',
    pattern: /\?\s+.+\(Y\/n\)/i,
    confidence: 'high',
  },

  // "Press Enter to continue" or similar
  {
    name: 'press_enter',
    pattern: /press enter to continue/i,
    confidence: 'high',
  },

  // Numbered menu with cursor indicator on option 1
  // e.g. "❯ 1. Yes" — requires the ❯ to prevent matching numbered lists in code
  {
    name: 'numbered_menu_cursor',
    pattern: /❯\s*\d+\.\s+/,
    confidence: 'high',
  },

  // "Allow" / "Deny" permission prompt (MCP tools, new tool approval)
  {
    name: 'allow_deny_prompt',
    pattern: /(?:always )?allow|(?:always )?deny/i,
    // Only match when combined with structural cues — this pattern alone
    // is too broad, so we check it in context with other evidence.
    confidence: 'medium',
    requiresContext: true,
  },
];

// ─────────────────────────────────────────────────────────────────
// BUSY patterns — checked ONLY against content above the prompt box.
// A match means Claude is actively working — suppress any pause trigger.
// ─────────────────────────────────────────────────────────────────
export const BUSY_PATTERNS = [
  // "ESC to interrupt" or "esc to interrupt" — Claude is processing
  {
    name: 'esc_to_interrupt',
    pattern: /esc to interrupt/i,
  },

  // "ctrl+c to interrupt" — alternate interrupt hint
  {
    name: 'ctrl_c_to_interrupt',
    pattern: /ctrl\+c to interrupt/i,
  },

  // Spinner activity label: ornament char + word ending in "ing" + ellipsis (…)
  // e.g. "✽ Tempering…", "✳ Simplifying…", "· Misting…"
  {
    name: 'spinner_activity',
    pattern: new RegExp(`^[${SPINNER_CHARS}] \\S+ing.*\u2026`, 'm'),
  },

  // Token stats / timing line above the prompt, e.g. "(9m 21s · ↓ 13.7k tokens)"
  // Requires parentheses, a digit, and the word "tokens"
  {
    name: 'token_stats_line',
    pattern: /\([^)]*\d[^)]*tokens\s*\)/i,
  },
];

// ─────────────────────────────────────────────────────────────────
// IGNORE patterns — when matched, maintain the current state.
// These indicate transient UI states that should not trigger transitions.
// ─────────────────────────────────────────────────────────────────
export const IGNORE_PATTERNS = [
  // "ctrl+r to toggle" — history search toggle, transient
  {
    name: 'ctrl_r_toggle',
    pattern: /ctrl\+r to toggle/i,
  },
];

// ─────────────────────────────────────────────────────────────────
// SEARCH patterns — indicate user is in search mode (idle, not paused).
// Takes precedence over everything.
// ─────────────────────────────────────────────────────────────────
export const SEARCH_PATTERN = /⌕ Search…/;

// ─────────────────────────────────────────────────────────────────
// Prompt box structural detection.
// Claude Code renders an input box with horizontal line borders:
//   ──────────────────  (top border)
//   ❯                   (prompt cursor line)
//   ──────────────────  (bottom border)
//
// Or with rounded corners:
//   ╭──────────────╮
//   │ >            │
//   ╰──────────────╯
// ─────────────────────────────────────────────────────────────────

/**
 * Detect the main Claude Code prompt box by looking for two horizontal
 * border lines (─) with a prompt character (❯) between them.
 * Returns the index of the top border line, or -1 if not found.
 */
export function findPromptBox(lines) {
  let borderCount = 0;
  let bottomBorderIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0 && /^─+$/.test(trimmed)) {
      borderCount++;
      if (borderCount === 1) {
        bottomBorderIdx = i;
      }
      if (borderCount === 2) {
        return { topBorder: i, bottomBorder: bottomBorderIdx };
      }
    }
  }

  // Also check for rounded-corner variant: ╭─╮ and ╰─╯
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/─+╯$/.test(line) || /^╰─+╯$/.test(line)) {
      // Found bottom border, look for top
      for (let j = i - 1; j >= 0; j--) {
        if (/─+╮$/.test(lines[j]) || /^╭─+╮$/.test(lines[j])) {
          return { topBorder: j, bottomBorder: i };
        }
      }
    }
  }

  return null;
}

/**
 * Extract the content above the prompt box (everything before the top border).
 * If no prompt box is found, returns all lines as a fallback.
 */
export function getContentAbovePromptBox(lines) {
  const box = findPromptBox(lines);
  if (box) {
    return lines.slice(0, box.topBorder);
  }
  return lines;
}

/**
 * Get the most recent contiguous block of content above the prompt box.
 * Skips trailing blanks, border chars, and prompt chars, then finds
 * the last non-empty block. This prevents stale busy markers in
 * scrollback from keeping the state stuck on "busy".
 */
export function getRecentBlockAbovePromptBox(lines) {
  const above = getContentAbovePromptBox(lines);

  // Strip trailing empty / border / prompt lines
  while (above.length > 0) {
    const trimmed = above[above.length - 1].trim();
    if (trimmed === '' || trimmed === '❯' || /^[-─\s]+$/.test(trimmed)) {
      above.pop();
      continue;
    }
    break;
  }

  if (above.length === 0) return '';

  // Walk backwards to find the start of the last contiguous block
  let start = above.length - 1;
  while (start >= 0) {
    const trimmed = above[start].trim();
    if (trimmed === '' || /^[-─\s]+$/.test(trimmed)) {
      start++;
      break;
    }
    start--;
  }

  return above.slice(Math.max(start, 0)).join('\n');
}
