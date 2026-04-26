// src/detection/index.js
// Barrel export for the pause detection system.

export { PauseDetector, STATE } from './PauseDetector.js';
export { installHook, watchStateFile, getStateFilePath } from './hookSetup.js';
export {
  WAITING_PATTERNS,
  BUSY_PATTERNS,
  IGNORE_PATTERNS,
  SEARCH_PATTERN,
  findPromptBox,
  getContentAbovePromptBox,
  getRecentBlockAbovePromptBox,
} from './patterns.js';
