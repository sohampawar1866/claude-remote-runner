<p align="center">
  <img src="logo.png" width="90" alt="Remote Claude Logo" />
</p>

# Claude Remote Runner

[![npm version](https://badge.fury.io/js/@sohampawar1866%2Fremote-claude.svg)](https://www.npmjs.com/package/@sohampawar1866/remote-claude)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A cross-platform CLI wrapper and Progressive Web App (PWA) that lets you control [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) remotely. Get push notifications on your phone whenever Claude pauses for input, approve or respond directly from your phone, and let your machine keep running.

## Features

- **Reliable Pause Detection** - 4-layer hybrid detection engine with 15+ patterns, prompt box structural parsing, Claude Code lifecycle hooks, silence-based fallback, and a state machine to prevent false positives.
- **Remote Control** - Get push notifications whenever Claude is paused (approval prompts, questions, tool permissions, etc.) and respond from your phone.
- **End-to-End Encryption** - All messages are encrypted with AES-256-GCM before leaving your machine. Nobody can read your prompts - not even the database host.
- **Cross-Platform Keep-Awake** - Prevents your Mac, Windows, or Linux machine from sleeping during long-running tasks.
- **Installable PWA** - A mobile frontend you can add to your home screen on iOS or Android for quick access.
- **Push Notifications via ntfy.sh** - Instant alerts with no setup or account needed.

## Installation

Install globally via npm:

```bash
npm install -g @sohampawar1866/remote-claude
```

## Usage

To start a remote session, simply run:

```bash
remote-claude
```

### Options

| Flag | Description |
|------|-------------|
| `-k, --keep-awake` | Prevent the system from sleeping while Claude runs |
| `-d, --debug` | Enable debug logging for pause detection state transitions |
| `--silence-threshold <ms>` | Silence threshold in ms before fallback pause detection (default: `3000`) |
| `--pattern-debounce <ms>` | Pattern match debounce in ms (default: `1500`) |
| `--no-hooks` | Disable automatic Claude Code hook installation |
| `-c, --command <cmd>` | Command to run (default: `claude`) |

### Examples

```bash
# Basic usage — keep machine awake
remote-claude -k

# Debug mode — see state transitions in real time
remote-claude -d

# Custom thresholds — more conservative detection
remote-claude --silence-threshold 5000 --pattern-debounce 2000

# Without hooks — rely only on terminal output parsing
remote-claude --no-hooks
```

On first launch, the CLI generates a secure URL. Open it on your phone to pair for that session.

## Architecture & Security

Security is a core concern for this tool. See the full **[Security Architecture Guide](./docs/SECURITY.md)** for details on the zero-trust model.

Here is how it works:

1. `remote-claude` wraps the `claude` CLI using `node-pty` and monitors terminal output with a multi-layered detection engine.
2. When Claude pauses for input, the CLI generates a random `channelId` and AES `encryptionKey`.
3. The prompt is **encrypted locally** and synced to your [Appwrite](https://appwrite.io/) database.
4. A push notification is sent to your phone with a URL like: `https://remote-claude.shaniai.tech/?c=<channelId>&k=<encryptionKey>`.
5. You open the link, the PWA decrypts the prompt in the browser, you type a response, and it encrypts your reply before sending it back.

The `encryptionKey` is passed through the URL and never stored on the backend. Nobody - not even the database admin - can read your prompts.

### Pause Detection Engine

The v1.5.0 detection system uses a 4-layer hybrid architecture:

| Layer | Method | Reliability |
|-------|--------|-------------|
| **1. Hook-Based IPC** | Auto-installs Claude Code lifecycle hooks (`Notification`, `Stop`) for direct state signals | Highest — zero regex needed |
| **2. Pattern Matching** | 15+ patterns derived from [CCManager](https://github.com/kbwo/ccmanager): approval prompts, permission dialogs, numbered menus, prompt box borders | High — covers all known Claude Code v2.x prompt formats |
| **3. Silence Fallback** | If no output for a configurable threshold and no busy indicators detected, triggers a pause check | Medium — universal safety net for unknown prompt formats |
| **4. State Machine** | Tracks `idle → busy → paused` transitions with debouncing to prevent false positives from screen redraws or stale scrollback | Context — prevents duplicate notifications and false transitions |

## Project Structure

```
claude-remote-runner/
├── bin/                         # CLI entry point
│   └── remote-claude.js         # Main executable (node-pty wrapper)
├── docs/                        # Documentation
│   └── SECURITY.md              # Security architecture guide
├── src/                         # CLI source modules
│   ├── config/                  # Configuration and defaults
│   ├── detection/               # Pause detection engine (v1.5.0)
│   │   ├── PauseDetector.js     # Core state machine + 4-layer engine
│   │   ├── patterns.js          # Pattern catalog + prompt box parsing
│   │   ├── hookSetup.js         # Claude Code lifecycle hook integration
│   │   └── index.js             # Barrel export
│   ├── services/                # Appwrite sync and ntfy notifications
│   └── utils/                   # Crypto and keep-awake utilities
├── mobile-app/                  # Self-contained PWA (deploy separately)
│   ├── src/
│   │   ├── components/          # React UI components
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # Appwrite client + WebCrypto
│   │   └── App.jsx              # Root component
│   └── vercel.json              # Vercel deployment config
├── LICENSE
├── README.md
└── package.json
```

## Zero-Config Architecture

By default, Claude Remote Runner operates with a **Zero-Config** setup:
- The CLI points to a shared, hosted Appwrite backend.
- The mobile frontend is pre-deployed on Vercel.
- You can simply `npm install -g` and start using it immediately without configuring any environment variables or databases.

**Security**: All data is encrypted with AES-256-GCM *before* it leaves your machine. The hosted backend cannot read your prompts or responses. The database uses `Any` permissions to support zero-config sync, but because of the encryption, your data is mathematically secure and inaccessible to anyone without the key (which is only present in your terminal and mobile URL).

## Self-Hosting (Optional)

If you prefer total data sovereignty, you can deploy your own instance of the frontend and backend.

### 1. Self-Hosting the Frontend
1. Fork or clone this repository.
2. Deploy the `mobile-app` directory to Vercel or Netlify.
3. Set your new URL in your CLI's `.env` file:
   ```bash
   FRONTEND_URL=https://your-own-deployment.example.com
   ```

### 2. Self-Hosting the Backend (Appwrite)
1. Create a project on [Appwrite Cloud](https://cloud.appwrite.io/) or self-host via Docker.
2. Create a database (e.g. `remote_runner`).
3. Create a collection named `messages` with these attributes:
   - `sessionId` (String, size 255)
   - `type` (String, size 50)
   - `content` (String, size 1000000)
   - `timestamp` (Datetime)
4. Go to the Indexes tab and create two Key indexes:
   - `sessionId_index` on the `sessionId` attribute
   - `type_index` on the `type` attribute
5. Set collection permissions to **Any** (Create, Read, Update, Delete). This is safe because all data is E2E encrypted before it reaches the database.
6. Create `.env` files:

**CLI `.env`**:
```bash
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_DATABASE_ID=your_db_id
APPWRITE_COLLECTION_ID=your_collection_id
```

**Mobile App `.env`** (Vite requires the `VITE_` prefix):
```bash
VITE_APPWRITE_PROJECT_ID=your_project_id
VITE_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
VITE_APPWRITE_DATABASE_ID=your_db_id
VITE_APPWRITE_COLLECTION_ID=your_collection_id
```

## Tech Stack

- **CLI Wrapper**: Node.js, `node-pty`, `strip-ansi`, `commander`
- **Pause Detection**: Custom 4-layer engine (hooks + pattern matching + silence fallback + state machine)
- **Mobile App**: React, Vite, Pure CSS (Custom Design System), `vite-plugin-pwa`
- **Backend & Sync**: Appwrite (Serverless Database & Realtime API)
- **Push Notifications**: ntfy.sh
- **Encryption**: AES-256-GCM (Node.js `crypto` + Web Crypto API)

## Uninstallation

To completely remove the Claude Remote Runner and clear your local configuration, run the following commands:

```bash
remote-claude reset
npm uninstall -g @sohampawar1866/remote-claude
```

## Looking to Collaborate

Right now, Claude Remote Runner works by wrapping the CLI in a pseudo-terminal and monitoring its output with a production-grade detection engine. The v1.5.0 detection system integrates with Claude Code's lifecycle hooks for the highest reliability, with pattern matching and silence-based fallbacks for universal coverage.

A direct integration inside an AI-powered IDE (like Cursor, Windsurf, or similar) would be a much better experience: instant pause detection, direct reply injection, and no setup for end users. The encryption layer, real-time sync, mobile PWA, and push notifications are all production-ready and transport-agnostic - they can plug into any agent framework, not just Claude Code.

**If you're building an AI-powered IDE or developer tool and want to offer remote mobile control as a built-in feature, feel free to open an issue or reach out.**

## License

MIT. See [LICENSE](./LICENSE).
